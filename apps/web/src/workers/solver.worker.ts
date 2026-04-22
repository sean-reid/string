/// <reference lib="webworker" />
import * as Comlink from "comlink";
import { getSolver } from "@/solver/wasm";
import type {
  BatchResult,
  InitResult,
  SolverInitExtras,
  SolverParamsJson,
  SolverWorkerApi,
} from "@/solver/types";

type WasmSolver = Awaited<ReturnType<typeof getSolver>>["Solver"] extends new (
  ...args: infer _A
) => infer R
  ? R
  : never;

let instance: WasmSolver | null = null;

function assertInstance(): WasmSolver {
  if (!instance) throw new Error("Solver has not been initialized");
  return instance;
}

const api: SolverWorkerApi = {
  async init(
    rgba: Uint8Array,
    size: number,
    params: SolverParamsJson,
    seed: bigint,
    extras: SolverInitExtras,
  ): Promise<InitResult> {
    const solver = await getSolver();
    instance?.free();
    instance = null;

    const wasmParams = new solver.SolverParams();
    wasmParams.pin_count = params.pin_count;
    wasmParams.line_budget = params.line_budget;
    wasmParams.opacity = params.opacity;
    wasmParams.min_chord_skip = params.min_chord_skip;
    wasmParams.ban_window = params.ban_window;
    wasmParams.temperature_start = params.temperature_start;
    wasmParams.temperature_end = params.temperature_end;
    wasmParams.face_x = extras.faceX;
    wasmParams.face_y = extras.faceY;
    wasmParams.face_w = extras.faceW;
    wasmParams.face_h = extras.faceH;
    wasmParams.face_emphasis = extras.faceEmphasis;

    instance = new solver.Solver(rgba, size, wasmParams, extras.paletteSrgb, seed);

    const pinPositions = instance.pinPositions();
    const copy = new Float32Array(pinPositions.length);
    copy.set(pinPositions);
    return {
      size,
      pinCount: instance.pinCount(),
      pinPositions: Comlink.transfer(copy, [copy.buffer]),
      lineBudget: instance.lineBudget(),
      paletteSize: instance.paletteSize(),
    };
  },

  async step(max: number): Promise<BatchResult> {
    const solver = assertInstance();
    const rawPins = solver.stepMany(max);
    const pins = new Uint16Array(rawPins.length);
    pins.set(rawPins);
    const rawColors = solver.lastBatchColors();
    const colors = new Uint8Array(rawColors.length);
    colors.set(rawColors);
    const done = solver.isDone() || pins.length === 0;
    const linesDrawn = solver.linesDrawn();
    return Comlink.transfer(
      { batch: pins, colors, linesDrawn, done },
      [pins.buffer, colors.buffer],
    );
  },

  async dispose(): Promise<void> {
    instance?.free();
    instance = null;
  },
};

Comlink.expose(api);
