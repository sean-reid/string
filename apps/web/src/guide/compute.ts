import {
  BOARDS,
  THREADS,
  type PhysicalParams,
} from "@/solver/physics";

const SECONDS_PER_LINE_BEGINNER = 12;
const SECONDS_PER_LINE_EXPERT = 4;
const SPOOL_YARDS = 350;
const BUFFER_FACTOR = 1.1;

export interface BomColor {
  /** sRGB hex of the palette entry. */
  color: string;
  /** Number of drawn lines using this thread. */
  lineCount: number;
  /** Physical thread length (mm) for this color, already buffer-adjusted. */
  mm: number;
  meters: number;
  yards: number;
  /** Spool count for this color, rounded up. */
  spools: number;
}

export interface Bom {
  boardLabel: string;
  boardDiameterMm: number;
  nailSpec: string;
  nailCount: number;
  nailHeightMm: number;
  threadLabel: string;
  threadDiameterMm: number;
  totalThreadMm: number;
  totalThreadMeters: number;
  totalThreadYards: number;
  threadSpools: number;
  buildMinutesBeginner: number;
  buildMinutesExpert: number;
  lineCount: number;
  /** Per-palette-color breakdown. Always length >= 1; matches
   *  `palette.length` in palette-of-one mode too, just one entry. */
  colors: BomColor[];
}

interface ChordLengths {
  total: number;
  byColor: number[];
  lineCountByColor: number[];
}

/** Walk the sequence once, returning total mm + per-color mm. */
function chordLengths(
  sequence: readonly number[],
  sequenceColors: readonly number[],
  pinPositions: Float32Array | null,
  imageSize: number,
  diameterMm: number,
  paletteLength: number,
): ChordLengths {
  const empty: ChordLengths = {
    total: 0,
    byColor: new Array(paletteLength).fill(0),
    lineCountByColor: new Array(paletteLength).fill(0),
  };
  if (!pinPositions || imageSize <= 0 || sequence.length < 2) return empty;
  const scale = diameterMm / imageSize;
  const byColor = new Array<number>(paletteLength).fill(0);
  const lineCountByColor = new Array<number>(paletteLength).fill(0);
  let total = 0;
  for (let i = 1; i < sequence.length; i++) {
    const from = sequence[i - 1];
    const to = sequence[i];
    if (from === undefined || to === undefined) continue;
    const fx = pinPositions[from * 2];
    const fy = pinPositions[from * 2 + 1];
    const tx = pinPositions[to * 2];
    const ty = pinPositions[to * 2 + 1];
    if (
      fx === undefined ||
      fy === undefined ||
      tx === undefined ||
      ty === undefined
    )
      continue;
    const dx = (tx - fx) * scale;
    const dy = (ty - fy) * scale;
    const len = Math.sqrt(dx * dx + dy * dy);
    total += len;
    const color = sequenceColors[i] ?? 0;
    const slot = color < paletteLength ? color : 0;
    byColor[slot] = (byColor[slot] ?? 0) + len;
    lineCountByColor[slot] = (lineCountByColor[slot] ?? 0) + 1;
  }
  return { total, byColor, lineCountByColor };
}

/** Compute the real thread length from actual chord distances. */
export function totalThreadMm(
  sequence: readonly number[],
  pinPositions: Float32Array | null,
  imageSize: number,
  diameterMm: number,
): number {
  const singleColor = new Array<number>(sequence.length).fill(0);
  return chordLengths(sequence, singleColor, pinPositions, imageSize, diameterMm, 1).total;
}

export function computeBom(
  physical: PhysicalParams,
  sequence: readonly number[],
  pinPositions: Float32Array | null,
  imageSize: number,
  sequenceColors: readonly number[] = [],
  palette: readonly string[] = [],
): Bom {
  const board = BOARDS[physical.boardId];
  const thread = THREADS[physical.threadId];
  const resolvedPalette =
    palette.length > 0 ? palette : [thread.defaultColor];
  const resolvedColors =
    sequenceColors.length === sequence.length
      ? sequenceColors
      : new Array<number>(sequence.length).fill(0);
  const raw = chordLengths(
    sequence,
    resolvedColors,
    pinPositions,
    imageSize,
    board.diameterMm,
    resolvedPalette.length,
  );
  const totalMm = raw.total * BUFFER_FACTOR;
  const meters = totalMm / 1000;
  const yards = meters * 1.09361;
  const spools = Math.max(1, Math.ceil(yards / SPOOL_YARDS));
  const lines = Math.max(0, sequence.length - 1);

  const colors: BomColor[] = resolvedPalette.map((hex, idx) => {
    const mm = (raw.byColor[idx] ?? 0) * BUFFER_FACTOR;
    const m = mm / 1000;
    const y = m * 1.09361;
    const perSpools = m > 0 ? Math.max(1, Math.ceil(y / SPOOL_YARDS)) : 0;
    return {
      color: hex,
      lineCount: raw.lineCountByColor[idx] ?? 0,
      mm,
      meters: m,
      yards: y,
      spools: perSpools,
    };
  });

  return {
    boardLabel: board.label,
    boardDiameterMm: board.diameterMm,
    nailSpec: "#17 wire brads or brass escutcheon pins, 5/8 in",
    nailCount: physical.pinCount,
    nailHeightMm: 11,
    threadLabel: thread.label,
    threadDiameterMm: thread.diameterMm,
    totalThreadMm: totalMm,
    totalThreadMeters: meters,
    totalThreadYards: yards,
    threadSpools: spools,
    buildMinutesBeginner: Math.round((lines * SECONDS_PER_LINE_BEGINNER) / 60),
    buildMinutesExpert: Math.round((lines * SECONDS_PER_LINE_EXPERT) / 60),
    lineCount: lines,
    colors,
  };
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours} h` : `${hours} h ${remaining} min`;
}
