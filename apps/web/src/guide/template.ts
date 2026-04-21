interface TemplateInput {
  pinPositions: Float32Array;
  imageSize: number;
  pinCount: number;
  diameterMm: number;
}

function fmt(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Builds a 1:1 scale SVG suitable for printing and taping to a wood disc.
 * Coordinates are in millimetres so the SVG prints at physical size.
 * Includes center crosshairs, all nail dots, numbered reference dots every
 * tenth position, and a calibration ruler so the user can verify the
 * printer is not scaling.
 */
export function buildTemplateSvg(input: TemplateInput): string {
  const { pinPositions, imageSize, pinCount, diameterMm } = input;
  const scale = diameterMm / imageSize;
  const size = diameterMm;
  const padding = 24; // mm of whitespace so labels and legend never clip
  const cx = size / 2;
  const cy = size / 2;
  const labelOffset = 9;

  const dots: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < pinCount; i++) {
    const x = (pinPositions[i * 2] ?? 0) * scale;
    const y = (pinPositions[i * 2 + 1] ?? 0) * scale;
    const isDecade = i % 10 === 0;
    dots.push(
      `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${isDecade ? 0.9 : 0.6}" fill="#000" />`,
    );
    if (isDecade) {
      const angle = Math.atan2(y - cy, x - cx);
      const lx = x + labelOffset * Math.cos(angle);
      const ly = y + labelOffset * Math.sin(angle);
      labels.push(
        `<text x="${fmt(lx)}" y="${fmt(ly)}" font-size="3" font-family="Courier, monospace" text-anchor="middle" dominant-baseline="middle" fill="#000">${i}</text>`,
      );
    }
  }

  const ruler = [
    `<g transform="translate(${fmt(size - 60)}, ${fmt(size + padding - 10)})">`,
    `<rect x="0" y="0" width="50" height="1.4" fill="#000" />`,
    `<line x1="0" y1="-2" x2="0" y2="3" stroke="#000" stroke-width="0.4" />`,
    `<line x1="10" y1="-1" x2="10" y2="2" stroke="#000" stroke-width="0.3" />`,
    `<line x1="20" y1="-1" x2="20" y2="2" stroke="#000" stroke-width="0.3" />`,
    `<line x1="25" y1="-2" x2="25" y2="3" stroke="#000" stroke-width="0.4" />`,
    `<line x1="30" y1="-1" x2="30" y2="2" stroke="#000" stroke-width="0.3" />`,
    `<line x1="40" y1="-1" x2="40" y2="2" stroke="#000" stroke-width="0.3" />`,
    `<line x1="50" y1="-2" x2="50" y2="3" stroke="#000" stroke-width="0.4" />`,
    `<text x="0" y="-3" font-size="3" font-family="Courier, monospace" fill="#000">0</text>`,
    `<text x="25" y="-3" font-size="3" font-family="Courier, monospace" fill="#000" text-anchor="middle">25</text>`,
    `<text x="50" y="-3" font-size="3" font-family="Courier, monospace" fill="#000" text-anchor="end">50 mm</text>`,
    `</g>`,
  ].join("");

  const crosshair = [
    `<line x1="${fmt(cx - 4)}" y1="${fmt(cy)}" x2="${fmt(cx + 4)}" y2="${fmt(cy)}" stroke="#000" stroke-width="0.2" />`,
    `<line x1="${fmt(cx)}" y1="${fmt(cy - 4)}" x2="${fmt(cx)}" y2="${fmt(cy + 4)}" stroke="#000" stroke-width="0.2" />`,
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="0.6" fill="#000" />`,
  ].join("");

  const totalSize = size + padding * 2;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalSize}mm" height="${totalSize}mm" viewBox="${-padding} ${-padding} ${totalSize} ${totalSize}">`,
    `  <title>Nail placement template, ${pinCount} nails on a ${size} mm disc</title>`,
    `  <rect x="${-padding}" y="${-padding}" width="${totalSize}" height="${totalSize}" fill="#fff" />`,
    `  <circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(size / 2 - 1)}" fill="none" stroke="#000" stroke-width="0.3" />`,
    `  ${crosshair}`,
    `  ${dots.join("\n  ")}`,
    `  ${labels.join("\n  ")}`,
    `  <text x="${fmt(cx)}" y="${fmt(-padding + 10)}" font-size="4" font-family="Courier, monospace" text-anchor="middle" fill="#000" font-weight="bold">${pinCount} nails · ${size} mm board</text>`,
    `  <text x="${fmt(cx)}" y="${fmt(-padding + 16)}" font-size="3.2" font-family="Courier, monospace" text-anchor="middle" fill="#444">Print at 100%. Verify the 50 mm ruler before hammering.</text>`,
    `  ${ruler}`,
    `</svg>`,
    ``,
  ].join("\n");
}
