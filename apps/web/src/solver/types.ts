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
  /** Tan-style face-weighted palette extraction in the worker. Returns
   *  flat sRGB bytes of length `k * 3`, ordered dark → light so the
   *  builder lays dark threads first. Pass `null` face for uniform
   *  sampling (no subject bias). */
  extractPalette(
    rgba: Uint8Array,
    size: number,
    k: number,
    seed: bigint,
    face: { x: number; y: number; w: number; h: number } | null,
  ): Promise<Uint8Array>;
  /** Run the preprocessing pipeline. `grayscale=true` collapses to luminance
   *  (R=G=B); `grayscale=false` preserves chroma per channel. */
  preprocess(
    rgba: Uint8Array,
    size: number,
    grayscale: boolean,
  ): Promise<Uint8Array>;
  dispose(): Promise<void>;
}
