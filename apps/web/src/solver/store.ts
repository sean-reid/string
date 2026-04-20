import { create } from "zustand";
import { useImageStore } from "@/image/store";
import type { SolverParamsJson, SolverStatus } from "./types";
import { getSolverWorker, terminateSolverWorker } from "./worker-client";

const DEFAULTS: SolverParamsJson = {
  pin_count: 288,
  line_budget: 2500,
  opacity: 0.1,
  min_chord_skip: 10,
  ban_window: 15,
  temperature_start: 0.02,
  temperature_end: 0.002,
};

const BATCH_SIZE = 24;

interface SolverState {
  status: SolverStatus;
  errorMessage: string | null;
  params: SolverParamsJson;
  seed: bigint;
  /** Pin indices in draw order. Includes the implicit starting pin at position 0 at index 0. */
  sequence: number[];
  pinPositions: Float32Array | null;
  pinCount: number;
  imageSize: number;
  linesDrawn: number;
  lineBudget: number;
  generationId: number;
  setParams: (update: Partial<SolverParamsJson>) => void;
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
        linesDrawn: result.linesDrawn,
      }));
    }
    if (result.done) {
      useSolverStore.setState({ status: "done" });
      return;
    }
    // Yield to the event loop so the UI can repaint.
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

export const useSolverStore = create<SolverState>((set, get) => ({
  status: "idle",
  errorMessage: null,
  params: { ...DEFAULTS },
  seed: 0x53_74_72_69_6e_67_01n,
  sequence: [],
  pinPositions: null,
  pinCount: 0,
  imageSize: 0,
  linesDrawn: 0,
  lineBudget: 0,
  generationId: 0,

  setParams(update) {
    set((prev) => ({ params: { ...prev.params, ...update } }));
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

    // Cancel any prior run.
    terminateSolverWorker();
    const generationId = get().generationId + 1;
    set({
      generationId,
      status: "running",
      errorMessage: null,
      sequence: [0],
      linesDrawn: 0,
      pinPositions: null,
      pinCount: 0,
      imageSize: image.meta.size,
    });

    try {
      // Read the preprocessed bitmap back to RGBA bytes so the solver can
      // consume it. The bitmap was produced from the same worker run of
      // preprocess() so its pixels match the solver's expected input.
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

      const remote = getSolverWorker();
      const init = await remote.init(rgba, image.meta.size, get().params, get().seed);
      if (get().generationId !== generationId) return;
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
      pinPositions: null,
      pinCount: 0,
      imageSize: 0,
      linesDrawn: 0,
      lineBudget: 0,
    }));
  },
}));
