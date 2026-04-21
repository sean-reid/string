import {
  BOARDS,
  THREADS,
  type PhysicalParams,
} from "@/solver/physics";

const SECONDS_PER_LINE_BEGINNER = 12;
const SECONDS_PER_LINE_EXPERT = 4;
const SPOOL_YARDS = 350;
const BUFFER_FACTOR = 1.1;

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
}

/** Compute the real thread length from actual chord distances. */
export function totalThreadMm(
  sequence: readonly number[],
  pinPositions: Float32Array | null,
  imageSize: number,
  diameterMm: number,
): number {
  if (!pinPositions || imageSize <= 0 || sequence.length < 2) return 0;
  const scale = diameterMm / imageSize;
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
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

export function computeBom(
  physical: PhysicalParams,
  sequence: readonly number[],
  pinPositions: Float32Array | null,
  imageSize: number,
): Bom {
  const board = BOARDS[physical.boardId];
  const thread = THREADS[physical.threadId];
  const mm = totalThreadMm(sequence, pinPositions, imageSize, board.diameterMm) *
    BUFFER_FACTOR;
  const meters = mm / 1000;
  const yards = meters * 1.09361;
  const spools = Math.max(1, Math.ceil(yards / SPOOL_YARDS));
  const lines = Math.max(0, sequence.length - 1);

  return {
    boardLabel: board.label,
    boardDiameterMm: board.diameterMm,
    nailSpec: "#17 wire brads or brass escutcheon pins, 5/8 in",
    nailCount: physical.pinCount,
    nailHeightMm: 11,
    threadLabel: thread.label,
    threadDiameterMm: thread.diameterMm,
    totalThreadMm: mm,
    totalThreadMeters: meters,
    totalThreadYards: yards,
    threadSpools: spools,
    buildMinutesBeginner: Math.round((lines * SECONDS_PER_LINE_BEGINNER) / 60),
    buildMinutesExpert: Math.round((lines * SECONDS_PER_LINE_EXPERT) / 60),
    lineCount: lines,
  };
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours} h` : `${hours} h ${remaining} min`;
}
