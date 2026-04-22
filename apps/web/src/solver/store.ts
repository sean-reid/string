import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useImageStore } from "@/image/store";
import {
  DEFAULT_PHYSICAL,
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
  /** Palette index per line in `sequence`. Length tracks `sequence.length`;
   *  entry 0 pairs with the anchor pin (always 0). */
  sequenceColors: number[];
  /** sRGB hex strings, one per palette index; PR 2 is always length 1. */
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
  palette: ["#f4efe5"],
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
    if (image.status !== "ready" || !image.bitmap || !image.meta) {
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
      const canvas = new OffscreenCanvas(image.meta.size, image.meta.size);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas 2D context not available.");
      ctx.drawImage(image.bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, image.meta.size, image.meta.size);
      const rgba = new Uint8Array(
        data.data.buffer,
        data.data.byteOffset,
        data.data.byteLength,
      );

      const physical = get().physical;
      const raw = deriveSolverParams(physical);
      const remote = getSolverWorker();
      const face = image.meta.faceBox;
      const extras: SolverInitExtras = {
        faceX: face?.x ?? 0,
        faceY: face?.y ?? 0,
        faceW: face?.w ?? 0,
        faceH: face?.h ?? 0,
        faceEmphasis: face ? DEFAULT_FACE_EMPHASIS : 0,
        paletteSrgb: paletteToSrgbBytes(physical.palette),
      };
      const init = await remote.init(
        rgba,
        image.meta.size,
        raw,
        get().seed,
        extras,
      );
      if (get().generationId !== generationId) return;
      set({
        palette: [...physical.palette],
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
    version: 2,
    migrate: (persisted, version) => {
      const state = persisted as Partial<SolverState> | undefined;
      if (!state) return state as unknown as SolverState;
      if (version < 2) {
        const seq = state.sequence ?? [];
        return {
          ...state,
          sequenceColors: new Array(seq.length).fill(0),
          palette: ["#f4efe5"],
        } as SolverState;
      }
      return state as SolverState;
    },
  }),
);
