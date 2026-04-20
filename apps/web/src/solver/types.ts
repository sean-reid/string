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
}

export interface BatchResult {
  /** Pin indices reached since the last batch. Empty when the solver finishes. */
  batch: Uint16Array;
  linesDrawn: number;
  done: boolean;
}

export interface SolverInitExtras {
  faceX: number;
  faceY: number;
  faceW: number;
  faceH: number;
  faceEmphasis: number;
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
