import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useImageStore } from "@/image/store";
import {
  DEFAULT_COLOR_LINE_BUDGET,
  DEFAULT_PHYSICAL,
  DEFAULT_THREAD_COLOR,
  MAX_PALETTE_SIZE,
  deriveColorBudgets,
  paletteToSrgbBytes,
  type PhysicalParams,
  deriveSolverParams,
} from "./physics";
import type { SolverInitExtras, SolverStatus } from "./types";
import { getSolverWorker, terminateSolverWorker } from "./worker-client";

const DEFAULT_FACE_EMPHASIS = 1.5;
const BATCH_SIZE = 24;
const STORAGE_KEY = "string.solver.v1";

function arraysShallowEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface SolverState {
  status: SolverStatus;
  errorMessage: string | null;
  physical: PhysicalParams;
  seed: bigint;
  sequence: number[];
  /** Palette index per line in `sequence`. All zero in mono mode;
   *  monotonic-ish in color mode (run-batched by switch cost). */
  sequenceColors: number[];
  /** Mirror of `physical.palette` for exports and canvas rendering. */
  palette: string[];
  pinPositions: Float32Array | null;
  pinCount: number;
  imageSize: number;
  linesDrawn: number;
  lineBudget: number;
  generationId: number;
  setPhysical: (update: Partial<PhysicalParams>) => void;
  setSeed: (seed: bigint) => void;
  /** Reset the palette back to the single-color default. Called
   *  whenever a new image is ingested — palettes are image-specific,
   *  so reusing yesterday's colors on a new subject makes no sense. */
  resetPalette: () => void;
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
    set((prev) => {
      const next: PhysicalParams = { ...prev.physical, ...update };
      if (update.palette !== undefined) {
        const wasColor = prev.physical.palette.length > 1;
        const isColor = next.palette.length > 1;
        // Auto-bump the default line budget when the user first
        // unlocks color mode — chromatic slots need headroom or the
        // accent colors starve. Only if the user hasn't already tuned
        // the mono default away; custom values are preserved.
        if (!wasColor && isColor && prev.physical.lineBudget === DEFAULT_PHYSICAL.lineBudget) {
          next.lineBudget = DEFAULT_COLOR_LINE_BUDGET;
        } else if (
          wasColor &&
          !isColor &&
          prev.physical.lineBudget === DEFAULT_COLOR_LINE_BUDGET
        ) {
          next.lineBudget = DEFAULT_PHYSICAL.lineBudget;
        }
        const paletteChanged = !arraysShallowEqual(prev.physical.palette, next.palette);
        if (paletteChanged && (prev.status === "running" || prev.status === "done")) {
          // Editing the palette makes the in-flight or just-finished
          // solve stale — invalidate it so the user's next Generate
          // runs against the new colors from scratch.
          terminateSolverWorker();
          return {
            physical: next,
            generationId: prev.generationId + 1,
            status: prev.status === "running" ? ("cancelled" as SolverStatus) : prev.status,
            sequence: prev.status === "running" ? [] : prev.sequence,
            sequenceColors: prev.status === "running" ? [] : prev.sequenceColors,
            linesDrawn: prev.status === "running" ? 0 : prev.linesDrawn,
          };
        }
      }
      return { physical: next };
    });
  },

  setSeed(seed) {
    set({ seed });
  },

  resetPalette() {
    set((prev) => ({
      physical: { ...prev.physical, palette: [DEFAULT_THREAD_COLOR] },
      palette: [DEFAULT_THREAD_COLOR],
    }));
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

      const palette = [...physical.palette]
        .slice(0, MAX_PALETTE_SIZE)
        .filter((c) => typeof c === "string" && c.length > 0);
      if (palette.length === 0) {
        palette.push(DEFAULT_THREAD_COLOR);
      }
      const inColorMode = palette.length > 1;

      // Color mode needs the full-chroma preprocessed input; mono
      // collapses to luminance so the scalar-residual path stays
      // byte-identical.
      const processed = await remote.preprocess(
        new Uint8Array(image.colorRgba),
        image.meta.size,
        !inColorMode,
      );
      if (get().generationId !== generationId) return;

      const raw = deriveSolverParams(physical);
      // e2e override: `?lines=N` shrinks the solve so tests finish in
      // seconds. No UI exposure; clamped to [10, physical.lineBudget] so
      // it can never exceed the user's chosen budget.
      if (typeof window !== "undefined") {
        const q = new URLSearchParams(window.location.search).get("lines");
        const n = q ? Number.parseInt(q, 10) : NaN;
        if (Number.isFinite(n) && n >= 10) {
          raw.line_budget = Math.min(n, physical.lineBudget);
        }
      }
      const face = image.meta.faceBox;
      const extras: SolverInitExtras = {
        faceX: face?.x ?? 0,
        faceY: face?.y ?? 0,
        faceW: face?.w ?? 0,
        faceH: face?.h ?? 0,
        faceEmphasis: face ? DEFAULT_FACE_EMPHASIS : 0,
        paletteSrgb: paletteToSrgbBytes(palette),
        colorBudgets: inColorMode
          ? deriveColorBudgets(palette, raw.line_budget)
          : undefined,
      };
      const init = await remote.init(
        processed,
        image.meta.size,
        raw,
        get().seed,
        extras,
      );
      if (get().generationId !== generationId) return;
      set({
        pinPositions: init.pinPositions,
        pinCount: init.pinCount,
        lineBudget: init.lineBudget,
        // Mirror the palette the solver ran with so the build guide
        // and exports render with the same colors even after the
        // user edits `physical.palette` post-solve.
        palette: [...palette],
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
