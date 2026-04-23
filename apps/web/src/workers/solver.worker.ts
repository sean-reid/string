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
    wasmParams.switch_cost_factor = params.switch_cost_factor;
    wasmParams.face_x = extras.faceX;
    wasmParams.face_y = extras.faceY;
    wasmParams.face_w = extras.faceW;
    wasmParams.face_h = extras.faceH;
    wasmParams.face_emphasis = extras.faceEmphasis;

    instance = new solver.Solver(rgba, size, wasmParams, extras.paletteSrgb, seed);

    if (extras.colorBudgets && extras.colorBudgets.length > 0) {
      instance.setColorBudgets(extras.colorBudgets);
    }

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

  async extractPalette(
    rgba: Uint8Array,
    size: number,
    k: number,
    seed: bigint,
    face: { x: number; y: number; w: number; h: number } | null,
  ): Promise<Uint8Array> {
    const solver = await getSolver();
    const bytes = solver.extractPalette(
      rgba,
      size,
      k,
      seed,
      face?.x ?? 0,
      face?.y ?? 0,
      face?.w ?? 0,
      face?.h ?? 0,
    );
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return Comlink.transfer(copy, [copy.buffer]);
  },

  async suggestNextColor(
    rgba: Uint8Array,
    size: number,
    existingSrgb: Uint8Array,
    face: { x: number; y: number; w: number; h: number } | null,
  ): Promise<Uint8Array> {
    const solver = await getSolver();
    const bytes = solver.suggestNextColor(
      rgba,
      size,
      existingSrgb,
      face?.x ?? 0,
      face?.y ?? 0,
      face?.w ?? 0,
      face?.h ?? 0,
    );
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return Comlink.transfer(copy, [copy.buffer]);
  },

  async preprocess(
    rgba: Uint8Array,
    size: number,
    grayscale: boolean,
  ): Promise<Uint8Array> {
    const solver = await getSolver();
    const params = new solver.PreprocessParams();
    params.grayscale = grayscale;
    const out = solver.preprocess(rgba, size, size, params);
    const copy = new Uint8Array(out.length);
    copy.set(out);
    return Comlink.transfer(copy, [copy.buffer]);
  },

  async dispose(): Promise<void> {
    instance?.free();
    instance = null;
  },
};

Comlink.expose(api);
