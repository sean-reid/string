export type SolverStatus = "idle" | "running" | "done" | "cancelled" | "error";

export interface SolverParamsJson {
  pin_count: number;
  line_budget: number;
  opacity: number;
  min_chord_skip: number;
  ban_window: number;
  temperature_start: number;
  temperature_end: number;
}

export interface InitResult {
  size: number;
  pinCount: number;
  pinPositions: Float32Array;
  lineBudget: number;
  paletteSize: number;
}

export interface BatchResult {
  /** Pin indices reached since the last batch. Empty when the solver finishes. */
  batch: Uint16Array;
  /** Palette index for each pin in `batch`. Always all-zero while the solver
   *  runs in monochrome mode; matching length to `batch`. */
  colors: Uint8Array;
  linesDrawn: number;
  done: boolean;
}

export interface SolverInitExtras {
  faceX: number;
  faceY: number;
  faceW: number;
  faceH: number;
  faceEmphasis: number;
  /** Flat sRGB bytes, length N*3. PR 2 only accepts N=1. */
  paletteSrgb: Uint8Array;
}

export interface SolverWorkerApi {
  init(
    rgba: Uint8Array,
    size: number,
    params: SolverParamsJson,
    seed: bigint,
    extras: SolverInitExtras,
  ): Promise<InitResult>;
  step(max: number): Promise<BatchResult>;
  dispose(): Promise<void>;
}
