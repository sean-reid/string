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

export const DEFAULT_THREAD_COLOR = "#111111";

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

export const MAX_PALETTE_SIZE = 6;

export interface PhysicalParams {
  boardId: BoardId;
  threadId: ThreadId;
  pinCount: number;
  lineBudget: number;
  /** Minimum chord length as a fraction of the board diameter. Kept
   *  internal — no user-facing slider; default value drives the solver. */
  minChordPct: number;
  /** sRGB hex strings. The authoritative set of thread colors the
   *  solver will run with. Users edit this directly via the palette
   *  picker (add / edit / remove swatches). */
  palette: string[];
}

export const DEFAULT_PHYSICAL: PhysicalParams = {
  boardId: "b12",
  threadId: "polyester",
  pinCount: 288,
  // Vrellis-style dark-on-cream uses a thin, low-opacity thread that
  // needs many crossings to build local darkness. The reference
  // algorithm uses ~4000 chords on a 300-pin board; we mirror that.
  lineBudget: 4000,
  minChordPct: 0.2,
  // Default to mono (black on cream). The palette picker lets the
  // user add up to MAX_PALETTE_SIZE - 1 extra colors; swapping in a
  // second color unlocks the 3-channel color solver.
  palette: [DEFAULT_THREAD_COLOR],
};

/// Target line budget when a user first unlocks color mode. Each
/// chromatic slot needs enough lines to emerge or it starves; the
/// reference Vrellis-like color portrait uses ~5000 lines across
/// ~4 colors. The store auto-bumps `physical.lineBudget` to this
/// value on the first mono→color transition and reverts on the
/// reverse transition — provided the user hasn't manually tuned
/// the budget away from its default.
export const DEFAULT_COLOR_LINE_BUDGET = 5000;

/// Multiplicative score penalty applied to candidate (pin, color)
/// pairs whose color differs from the currently wound spool. Mono
/// ignores this; color mode uses it to produce Vrellis-style
/// contiguous runs instead of interleaved chaos.
export const DEFAULT_SWITCH_COST_FACTOR = 0.15;

/** mm per solver-internal pixel at the given board size. */
export function pixelMm(board: BoardSpec): number {
  return board.diameterMm / SOLVE_RESOLUTION_PX;
}

/**
 * Effective per-crossing opacity of one thread pass through one solver-
 * internal pixel. Geometric coverage (thread diameter / pixel size) is
 * an upper bound — a real thread isn't fully opaque at a single
 * crossing, and for the Vrellis-style dense cobweb we need many
 * crossings to build local darkness rather than one or two high-alpha
 * passes. The attenuation factor brings effective per-crossing opacity
 * into the 0.03–0.05 range the reference algorithms use; 4000 chords
 * at this opacity give the characteristic density without
 * oversaturating.
 */
export function threadCoverage(thread: ThreadSpec, board: BoardSpec): number {
  const raw = thread.diameterMm / pixelMm(board);
  const geometric = Math.min(Math.max(raw, 0.05), 0.5);
  return geometric * THREAD_OPACITY_ATTENUATION;
}

/**
 * Scales geometric thread coverage down to a physically realistic
 * per-crossing opacity. The halfmonty / kmmeerts reference uses
 * LINE_WEIGHT ≈ 0.031 — very low per crossing, demanding many chords
 * before local darkness emerges. We split the difference: 0.2 gives
 * ~0.07 effective opacity on our 0.34 geometric coverage, which
 * lets the default 4000-chord budget saturate the image's darkest
 * pixels without also saturating everything else by chord 1500 and
 * leaving the back half of the budget to accumulate noise on the rim.
 */
const THREAD_OPACITY_ATTENUATION = 0.2;

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
  const inColorMode = physical.palette.length > 1;
  return {
    pin_count: physical.pinCount,
    line_budget: physical.lineBudget,
    opacity,
    min_chord_skip: minSkip,
    ban_window: banWindow,
    temperature_start: 0.008,
    temperature_end: 0.0008,
    switch_cost_factor: inColorMode ? DEFAULT_SWITCH_COST_FACTOR : 0,
  };
}

/**
 * Minimum fraction of the line budget any single color is allowed to
 * receive, regardless of its explanatory share. Prevents a near-zero
 * share color (e.g. a pale yellow highlight on a darker image) from
 * being starved to literally zero lines. `0.05` leaves enough room
 * for five balanced colors and still protects the weakest.
 */
export const COLOR_BUDGET_FLOOR = 0.05;

/**
 * Derive per-color line budgets from image-aware explanatory shares.
 * `shares` is the WASM-computed fraction of gamut each palette slot
 * explains (summing to 1.0). We apply `COLOR_BUDGET_FLOOR` as a
 * minimum per-color share, renormalize, and convert to integer chord
 * counts summing to `lineBudget`.
 *
 * Falls back to an even split when `shares` is empty or malformed —
 * preserves legacy behavior for callers that haven't wired up the
 * image-aware path yet.
 *
 * `0` entries mean unbudgeted; only used when palette size is 1.
 */
export function deriveColorBudgets(
  palette: readonly string[],
  lineBudget: number,
  shares?: Float32Array | readonly number[],
): Uint32Array {
  if (palette.length <= 1) {
    return new Uint32Array();
  }
  const n = palette.length;
  const total = Math.max(lineBudget, n);

  let weights: number[];
  if (shares && shares.length === n) {
    // Apply floor, then normalize to sum 1.
    const floored = Array.from(shares, (s) => Math.max(s, COLOR_BUDGET_FLOOR));
    const sum = floored.reduce((a, b) => a + b, 0);
    weights = sum > 0 ? floored.map((w) => w / sum) : Array(n).fill(1 / n);
  } else {
    // Legacy fallback: 40% shadow anchor, even split across the rest.
    weights = Array(n).fill(0);
    weights[0] = 0.4;
    const perChrom = 0.6 / (n - 1);
    for (let i = 1; i < n; i += 1) weights[i] = perChrom;
  }

  // Integer allocation via largest-remainder so the budgets sum
  // exactly to `total`.
  const raw = weights.map((w) => w * total);
  const floor = raw.map((r) => Math.floor(r));
  let allocated = floor.reduce((a, b) => a + b, 0);
  const remainders = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  let idx = 0;
  while (allocated < total && idx < remainders.length) {
    const entry = remainders[idx];
    if (entry) {
      floor[entry.i] = (floor[entry.i] ?? 0) + 1;
      allocated += 1;
    }
    idx += 1;
  }

  const budgets = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) budgets[i] = floor[i] ?? 0;
  return budgets;
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

/** Inverse of parseHexColor for rendering swatch labels. */
export function srgbBytesToHex(bytes: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    const r = (bytes[i] ?? 0).toString(16).padStart(2, "0");
    const g = (bytes[i + 1] ?? 0).toString(16).padStart(2, "0");
    const b = (bytes[i + 2] ?? 0).toString(16).padStart(2, "0");
    out.push(`#${r}${g}${b}`);
  }
  return out;
}
