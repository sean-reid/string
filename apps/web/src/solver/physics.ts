import type { SolverParamsJson } from "./types";

export type ThreadId = "polyester" | "dmcFloss" | "crochetCotton";
export type BoardId = "b12" | "b16" | "b20" | "b24";

export interface ThreadSpec {
  id: ThreadId;
  label: string;
  diameterMm: number;
  description: string;
  /** sRGB hex used when the user hasn't picked a custom palette yet. Seeds
   *  `PhysicalParams.palette[0]` and the fallback render color. */
  defaultColor: string;
}

export interface BoardSpec {
  id: BoardId;
  label: string;
  diameterMm: number;
}

export const DEFAULT_THREAD_COLOR = "#f4efe5";

export const THREADS: Record<ThreadId, ThreadSpec> = {
  polyester: {
    id: "polyester",
    label: "Polyester (fine)",
    diameterMm: 0.2,
    description: "Thinnest, most cobweb-like. Many thread passes per region.",
    defaultColor: DEFAULT_THREAD_COLOR,
  },
  dmcFloss: {
    id: "dmcFloss",
    label: "Embroidery thread (2-strand)",
    diameterMm: 0.3,
    description: "Medium weight embroidery thread like DMC floss, split to two strands.",
    defaultColor: DEFAULT_THREAD_COLOR,
  },
  crochetCotton: {
    id: "crochetCotton",
    label: "Crochet cotton #10",
    diameterMm: 0.4,
    description: "Bolder threads. Fewer passes needed per region.",
    defaultColor: DEFAULT_THREAD_COLOR,
  },
};

export const BOARDS: Record<BoardId, BoardSpec> = {
  b12: { id: "b12", label: "12 in (305 mm)", diameterMm: 305 },
  b16: { id: "b16", label: "16 in (406 mm)", diameterMm: 406 },
  b20: { id: "b20", label: "20 in (508 mm)", diameterMm: 508 },
  b24: { id: "b24", label: "24 in (610 mm)", diameterMm: 610 },
};

/** Internal solver resolution. The preprocessor crops to this size. */
export const SOLVE_RESOLUTION_PX = 700;

export interface PhysicalParams {
  boardId: BoardId;
  threadId: ThreadId;
  pinCount: number;
  lineBudget: number;
  /** Minimum chord length as a fraction of the board diameter. */
  minChordPct: number;
  /** sRGB hex strings, one per thread color in the palette. Length 1 is
   *  monochrome (the legacy behavior); PR 5 lets the user extend it. */
  palette: string[];
}

export const DEFAULT_PHYSICAL: PhysicalParams = {
  boardId: "b16",
  threadId: "polyester",
  pinCount: 288,
  lineBudget: 1500,
  minChordPct: 0.2,
  palette: [DEFAULT_THREAD_COLOR],
};

/** mm per solver-internal pixel at the given board size. */
export function pixelMm(board: BoardSpec): number {
  return board.diameterMm / SOLVE_RESOLUTION_PX;
}

/**
 * Single-pass thread coverage of one solver-internal pixel. Clamped to a
 * sensible range so tiny pixels or tiny threads still converge.
 */
export function threadCoverage(thread: ThreadSpec, board: BoardSpec): number {
  const raw = thread.diameterMm / pixelMm(board);
  return Math.min(Math.max(raw, 0.05), 0.5);
}

/**
 * Minimum pin-index skip to guarantee the chord is at least `pct` of the
 * diameter long. Derived from chord = 2 r sin(theta/2) where theta =
 * 2 pi skip / pinCount.
 */
export function minSkipPins(pct: number, pinCount: number): number {
  const clampedPct = Math.min(Math.max(pct, 0), 0.99);
  const angleRad = 2 * Math.asin(clampedPct);
  return Math.max(1, Math.ceil((pinCount * angleRad) / (2 * Math.PI)));
}

export function deriveSolverParams(
  physical: PhysicalParams,
): SolverParamsJson {
  const board = BOARDS[physical.boardId];
  const thread = THREADS[physical.threadId];
  const opacity = threadCoverage(thread, board);
  const minSkip = minSkipPins(physical.minChordPct, physical.pinCount);
  const banWindow = Math.max(5, Math.round(physical.pinCount * 0.07));
  return {
    pin_count: physical.pinCount,
    line_budget: physical.lineBudget,
    opacity,
    min_chord_skip: minSkip,
    ban_window: banWindow,
    temperature_start: 0.008,
    temperature_end: 0.0008,
  };
}

/** Approximate total thread length in meters for a given plan. */
export function estimatedThreadMeters(physical: PhysicalParams): number {
  const board = BOARDS[physical.boardId];
  // Average chord length on a circle ~ 4r/pi. Use 0.5 * diameter as a
  // reasonable mid-estimate once min-skip and ban are factored in.
  const avgChordM = (board.diameterMm * 0.5) / 1000;
  return Math.round(physical.lineBudget * avgChordM);
}

/** Approximate build time (hours) for a first-time string artist. */
export function estimatedBuildHours(physical: PhysicalParams): number {
  const secondsPerLine = 10;
  return Math.round((physical.lineBudget * secondsPerLine) / 3600);
}

/** Parse `#rrggbb` or `#rgb` into [r,g,b] bytes. Returns null for garbage. */
export function parseHexColor(hex: string): [number, number, number] | null {
  const raw = hex.trim().toLowerCase();
  let body: string | null = null;
  const full = /^#([0-9a-f]{6})$/.exec(raw);
  if (full?.[1]) {
    body = full[1];
  } else {
    const short = /^#([0-9a-f]{3})$/.exec(raw);
    if (short?.[1]) {
      body = short[1]
        .split("")
        .map((c) => c + c)
        .join("");
    }
  }
  if (!body) return null;
  return [
    parseInt(body.slice(0, 2), 16),
    parseInt(body.slice(2, 4), 16),
    parseInt(body.slice(4, 6), 16),
  ];
}

/** Pack a palette of sRGB hex strings into the flat byte buffer the wasm
 *  solver expects (length = palette.length * 3). */
export function paletteToSrgbBytes(palette: readonly string[]): Uint8Array {
  const out = new Uint8Array(palette.length * 3);
  palette.forEach((hex, i) => {
    const rgb = parseHexColor(hex) ?? [0xf4, 0xef, 0xe5];
    out[i * 3] = rgb[0];
    out[i * 3 + 1] = rgb[1];
    out[i * 3 + 2] = rgb[2];
  });
  return out;
}
