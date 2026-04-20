interface SequenceMeta {
  pinCount: number;
  diameterMm: number;
  threadLabel: string;
  lineCount: number;
}

export function renderText(sequence: readonly number[]): string {
  return sequence.join(", ") + "\n";
}

export function renderCsv(
  sequence: readonly number[],
  meta: SequenceMeta,
): string {
  const header = [
    `# String-art pattern`,
    `# nails,${meta.pinCount}`,
    `# diameter_mm,${meta.diameterMm}`,
    `# thread,${meta.threadLabel}`,
    `# lines,${meta.lineCount}`,
    `step,nail`,
  ];
  const rows = sequence.map((nail, step) => `${step},${nail}`);
  return header.concat(rows).join("\n") + "\n";
}
