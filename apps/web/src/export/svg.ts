interface SvgExportInput {
  sequence: readonly number[];
  pinPositions: Float32Array | null;
  imageSize: number;
  diameterMm: number;
  threadColor: string;
  lineOpacity: number;
  lineWidthMm: number;
  backgroundColor: string;
  pinCount: number;
}

function fmt(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

/**
 * Emit a print-ready SVG with a circular disk background, the circular
 * boundary, and every thread chord as an individual <line>. Coordinates
 * are in millimetres so it opens at real physical size in any vector
 * editor or plotter.
 */
export function renderSvg(input: SvgExportInput): string {
  if (!input.pinPositions || input.imageSize <= 0) {
    throw new Error("No pattern to export.");
  }

  const size = input.diameterMm;
  const scale = input.diameterMm / input.imageSize;
  const radius = size / 2;
  const lines: string[] = [];

  for (let i = 1; i < input.sequence.length; i++) {
    const from = input.sequence[i - 1];
    const to = input.sequence[i];
    if (from === undefined || to === undefined) continue;
    const fx = input.pinPositions[from * 2];
    const fy = input.pinPositions[from * 2 + 1];
    const tx = input.pinPositions[to * 2];
    const ty = input.pinPositions[to * 2 + 1];
    if (
      fx === undefined ||
      fy === undefined ||
      tx === undefined ||
      ty === undefined
    )
      continue;
    lines.push(
      `<line x1="${fmt(fx * scale)}" y1="${fmt(fy * scale)}" x2="${fmt(tx * scale)}" y2="${fmt(ty * scale)}" />`,
    );
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="0 0 ${size} ${size}">`,
    `  <title>String-art pattern, ${input.sequence.length - 1} lines on ${input.pinCount} nails</title>`,
    `  <rect width="${size}" height="${size}" fill="${input.backgroundColor}" />`,
    `  <circle cx="${radius}" cy="${radius}" r="${radius - 0.5}" fill="${input.backgroundColor}" stroke="#141311" stroke-width="0.25" />`,
    `  <g stroke="${input.threadColor}" stroke-width="${input.lineWidthMm}" stroke-linecap="round" stroke-opacity="${input.lineOpacity}" fill="none">`,
    ...lines.map((l) => `    ${l}`),
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}
