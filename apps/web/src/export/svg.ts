interface SvgExportInput {
  sequence: readonly number[];
  /** Palette index per line, parallel to `sequence`. */
  sequenceColors: readonly number[];
  palette: readonly string[];
  pinPositions: Float32Array | null;
  imageSize: number;
  diameterMm: number;
  lineOpacity: number;
  lineWidthMm: number;
  backgroundColor: string;
  pinCount: number;
}

const FALLBACK_COLOR = "#f4efe5";

function fmt(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

/**
 * Emit a print-ready SVG with a circular disk background, the circular
 * boundary, and every thread chord as an individual `<line>`. Lines are
 * grouped by palette color (`<g data-color="cN">`) to help downstream
 * plotter / cutter tooling that picks one color per pen run.
 * Coordinates are in millimetres so the file opens at real physical
 * size in any vector editor.
 */
export function renderSvg(input: SvgExportInput): string {
  if (!input.pinPositions || input.imageSize <= 0) {
    throw new Error("No pattern to export.");
  }

  const size = input.diameterMm;
  const scale = input.diameterMm / input.imageSize;
  const radius = size / 2;
  // One line list per palette entry; preserves solve order within a color.
  const linesByColor: string[][] = input.palette.map(() => []);

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
    const color = input.sequenceColors[i] ?? 0;
    const bucket = linesByColor[color] ?? linesByColor[0];
    if (!bucket) continue;
    bucket.push(
      `<line x1="${fmt(fx * scale)}" y1="${fmt(fy * scale)}" x2="${fmt(tx * scale)}" y2="${fmt(ty * scale)}" />`,
    );
  }

  const groups: string[] = [];
  linesByColor.forEach((lines, idx) => {
    if (lines.length === 0) return;
    const hex = input.palette[idx] ?? FALLBACK_COLOR;
    groups.push(
      `  <g data-color="c${idx}" stroke="${hex}" stroke-width="${input.lineWidthMm}" stroke-linecap="round" stroke-opacity="${input.lineOpacity}" fill="none">`,
      ...lines.map((l) => `    ${l}`),
      `  </g>`,
    );
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="0 0 ${size} ${size}">`,
    `  <title>String-art pattern, ${input.sequence.length - 1} lines on ${input.pinCount} nails</title>`,
    `  <rect width="${size}" height="${size}" fill="${input.backgroundColor}" />`,
    `  <circle cx="${radius}" cy="${radius}" r="${radius - 0.5}" fill="${input.backgroundColor}" stroke="#141311" stroke-width="0.25" />`,
    ...groups,
    `</svg>`,
    ``,
  ].join("\n");
}
