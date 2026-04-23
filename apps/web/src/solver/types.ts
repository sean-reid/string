export type SolverStatus = "idle" | "running" | "done" | "cancelled" | "error";

export interface SolverParamsJson {
  pin_count: number;
  line_budget: number;
  opacity: number;
  min_chord_skip: number;
  ban_window: number;
  temperature_start: number;
  temperature_end: number;
  /** Run-batching penalty: score multiplier for (pin, color) pairs
   *  that would require switching away from the current spool.
   *  `0` is fully interleaved; `0.15` is the color-mode default.
   *  Ignored in mono. */
  switch_cost_factor: number;
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
  /** Flat sRGB bytes, length N*3, one triple per palette slot. Length
   *  1 runs the mono path; >1 enables the 3-channel color solver. */
  paletteSrgb: Uint8Array;
  /** Per-color line caps matching palette slot order. `0` entries mean
   *  uncapped for that slot. Omit or pass empty for uncapped-all
   *  behavior (legacy). */
  colorBudgets?: Uint32Array;
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
  /** Saliency-weighted palette extraction in the worker. Returns
   *  flat sRGB bytes of length `k * 3`, ordered dark → light.
   *  Pass `null` face for uniform sampling (no subject bias). */
  extractPalette(
    rgba: Uint8Array,
    size: number,
    k: number,
    seed: bigint,
    face: { x: number; y: number; w: number; h: number } | null,
  ): Promise<Uint8Array>;
  /** Suggest the single best next color to extend an existing partial
   *  palette's gamut coverage. Returns 3 sRGB bytes. `existingSrgb`
   *  is a flat `N * 3` buffer matching the palette format used by
   *  `paletteSrgb`. */
  suggestNextColor(
    rgba: Uint8Array,
    size: number,
    existingSrgb: Uint8Array,
    face: { x: number; y: number; w: number; h: number } | null,
  ): Promise<Uint8Array>;
  /** Per-color explanatory share (summing to 1.0) of the image given
   *  `paletteSrgb`. Used to allocate image-aware line budgets: a
   *  red-heavy portrait returns a high red share, so red gets a
   *  larger slice of the line budget than an even split would give. */
  paletteExplanatoryShares(
    rgba: Uint8Array,
    size: number,
    paletteSrgb: Uint8Array,
    face: { x: number; y: number; w: number; h: number } | null,
  ): Promise<Float32Array>;
  /** Run the preprocessing pipeline. `grayscale=true` collapses to luminance
   *  (R=G=B); `grayscale=false` preserves chroma per channel. */
  preprocess(
    rgba: Uint8Array,
    size: number,
    grayscale: boolean,
  ): Promise<Uint8Array>;
  dispose(): Promise<void>;
}
