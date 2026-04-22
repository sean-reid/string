import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useImageStore } from "@/image/store";
import {
  DEFAULT_PHYSICAL,
  DEFAULT_THREAD_COLOR,
  paletteToSrgbBytes,
  type PhysicalParams,
  deriveSolverParams,
} from "./physics";
import type { SolverInitExtras, SolverStatus } from "./types";
import { getSolverWorker, terminateSolverWorker } from "./worker-client";

const DEFAULT_FACE_EMPHASIS = 1.5;
const BATCH_SIZE = 24;
const STORAGE_KEY = "string.solver.v1";

interface SolverState {
  status: SolverStatus;
  errorMessage: string | null;
  physical: PhysicalParams;
  seed: bigint;
  sequence: number[];
  /** Palette index per line in `sequence`. Always-zero in mono-only
   *  mode; kept as a stored field for downstream exports that
   *  serialize it regardless. */
  sequenceColors: number[];
  /** Mirror of `physical.palette` for exports and canvas rendering.
   *  In mono-only mode this is always `[#111111]`. */
  palette: string[];
  pinPositions: Float32Array | null;
  pinCount: number;
  imageSize: number;
  linesDrawn: number;
  lineBudget: number;
  generationId: number;
  setPhysical: (update: Partial<PhysicalParams>) => void;
  setSeed: (seed: bigint) => void;
  start: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

async function runSolverLoop(get: () => SolverState, generationId: number) {
  const remote = getSolverWorker();
  while (true) {
    if (get().generationId !== generationId) return;
    if (get().status !== "running") return;
    const result = await remote.step(BATCH_SIZE);
    if (get().generationId !== generationId) return;
    if (result.batch.length > 0) {
      useSolverStore.setState((prev) => ({
        sequence: prev.sequence.concat(Array.from(result.batch)),
        sequenceColors: prev.sequenceColors.concat(Array.from(result.colors)),
        linesDrawn: result.linesDrawn,
      }));
    }
    if (result.done) {
      useSolverStore.setState({ status: "done" });
      return;
    }
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

const baseStoreFactory = (
  set: (partial: Partial<SolverState> | ((prev: SolverState) => Partial<SolverState>)) => void,
  get: () => SolverState,
): SolverState => ({
  status: "idle",
  errorMessage: null,
  physical: { ...DEFAULT_PHYSICAL },
  seed: 0x53_74_72_69_6e_67_01n,
  sequence: [],
  sequenceColors: [],
  palette: ["#111111"],
  pinPositions: null,
  pinCount: 0,
  imageSize: 0,
  linesDrawn: 0,
  lineBudget: 0,
  generationId: 0,

  setPhysical(update) {
    set((prev) => ({ physical: { ...prev.physical, ...update } }));
  },

  setSeed(seed) {
    set({ seed });
  },

  async start() {
    const image = useImageStore.getState();
    if (
      image.status !== "ready" ||
      !image.bitmap ||
      !image.meta ||
      !image.colorRgba
    ) {
      set({ status: "error", errorMessage: "Load an image first." });
      return;
    }

    terminateSolverWorker();
    const generationId = get().generationId + 1;
    set({
      generationId,
      status: "running",
      errorMessage: null,
      sequence: [0],
      sequenceColors: [0],
      linesDrawn: 0,
      pinPositions: null,
      pinCount: 0,
      imageSize: image.meta.size,
    });

    try {
      const physical = get().physical;
      const remote = getSolverWorker();

      // Mono-only: always a single-black palette. No image-derived
      // palette extraction, no suggestions list.
      const palette = [...physical.palette];

      const processed = await remote.preprocess(
        new Uint8Array(image.colorRgba),
        image.meta.size,
        true,
      );
      if (get().generationId !== generationId) return;

      const raw = deriveSolverParams(physical);
      const face = image.meta.faceBox;
      const extras: SolverInitExtras = {
        faceX: face?.x ?? 0,
        faceY: face?.y ?? 0,
        faceW: face?.w ?? 0,
        faceH: face?.h ?? 0,
        faceEmphasis: face ? DEFAULT_FACE_EMPHASIS : 0,
        paletteSrgb: paletteToSrgbBytes(palette),
      };
      const init = await remote.init(
        processed,
        image.meta.size,
        raw,
        get().seed,
        extras,
      );
      if (get().generationId !== generationId) return;
      // Note: do NOT write `palette` here. `store.palette` holds the
      // image-derived suggestions populated before the solve; the
      // user's chosen palette lives in `physical.palette` and doesn't
      // need mirroring back into the store.
      set({
        pinPositions: init.pinPositions,
        pinCount: init.pinCount,
        lineBudget: init.lineBudget,
      });

      await runSolverLoop(get, generationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Solver failed.";
      if (get().generationId === generationId) {
        set({ status: "error", errorMessage: message });
      }
    }
  },

  cancel() {
    const prev = get().generationId;
    terminateSolverWorker();
    set({ generationId: prev + 1, status: "cancelled" });
  },

  reset() {
    terminateSolverWorker();
    set((prev) => ({
      generationId: prev.generationId + 1,
      status: "idle",
      errorMessage: null,
      sequence: [],
      sequenceColors: [],
      pinPositions: null,
      pinCount: 0,
      imageSize: 0,
      linesDrawn: 0,
      lineBudget: 0,
    }));
  },
});

export const useSolverStore = create<SolverState>()(
  persist(baseStoreFactory, {
    name: STORAGE_KEY,
    storage: createJSONStorage(() => localStorage, {
      reviver: (key, value) => {
        if (key === "pinPositions" && Array.isArray(value)) {
          return new Float32Array(value as number[]);
        }
        if (key === "seed" && typeof value === "string") {
          return BigInt(value);
        }
        return value;
      },
      replacer: (_key, value) => {
        if (value instanceof Float32Array) {
          return Array.from(value);
        }
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      },
    }),
    partialize: (state) => ({
      status: state.status === "running" ? "cancelled" : state.status,
      physical: state.physical,
      seed: state.seed,
      sequence: state.sequence,
      sequenceColors: state.sequenceColors,
      palette: state.palette,
      pinPositions: state.pinPositions,
      pinCount: state.pinCount,
      imageSize: state.imageSize,
      linesDrawn: state.linesDrawn,
      lineBudget: state.lineBudget,
    }),
    version: 5,
    migrate: (persisted, version) => {
      const state = persisted as Partial<SolverState> | undefined;
      if (!state) return state as unknown as SolverState;
      if (version < 2) {
        const seq = state.sequence ?? [];
        state.sequenceColors = new Array(seq.length).fill(0);
        state.palette = [DEFAULT_THREAD_COLOR];
      }
      // v5: mono-only. Force palette to default black regardless of
      // what was persisted from a multi-color session.
      if (version < 5) {
        state.palette = [DEFAULT_THREAD_COLOR];
        if (state.physical) {
          state.physical = {
            ...state.physical,
            palette: [DEFAULT_THREAD_COLOR],
          };
        }
      }
      // v3 / v4: palette UX dropped auto vs manual modes and the
      // paletteCount slider in favour of direct swatch editing. Strip
      // the old fields if they survived in persisted state; rebuild
      // `physical` around what we still keep.
      if (version < 4) {
        const existing = state.physical as Partial<PhysicalParams> | undefined;
        const paletteFromPhysical = existing?.palette;
        const paletteFromRoot = state.palette;
        const resolvedPalette =
          paletteFromPhysical && paletteFromPhysical.length > 0
            ? paletteFromPhysical
            : paletteFromRoot && paletteFromRoot.length > 0
              ? paletteFromRoot
              : [DEFAULT_THREAD_COLOR];
        state.physical = {
          ...DEFAULT_PHYSICAL,
          ...(existing ?? {}),
          palette: resolvedPalette,
        };
      }
      return state as SolverState;
    },
  }),
);
