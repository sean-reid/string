import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { parseHexColor } from "@/solver/physics";

const LETTER_WIDTH_PT = 612;
const LETTER_HEIGHT_PT = 792;
const MARGIN_PT = 40;
const COLS = 2;
const COL_GAP_PT = 16;
const ROW_HEIGHT_PT = 16;
const HEADER_HEIGHT_PT = 44;

interface Input {
  sequence: readonly number[];
  /** Palette index per line in `sequence`. Same length; used to draw the
   *  color swatch beside each step and build the legend page. */
  sequenceColors?: readonly number[];
  /** sRGB hex strings. Length 1 renders the legacy booklet; length > 1
   *  adds a color-legend page up front and paints a dot per step. */
  palette?: readonly string[];
  pinCount: number;
  diameterMm: number;
  threadLabel: string;
}

function hexToPdfRgb(hex: string | undefined): RGB {
  const parsed = parseHexColor(hex ?? "#f4efe5") ?? [0xf4, 0xef, 0xe5];
  return rgb(parsed[0] / 255, parsed[1] / 255, parsed[2] / 255);
}

/**
 * Paginated sequence booklet as a real PDF. Two columns of checkbox + step
 * + nail per page, tight but legible on letter. Each page carries a
 * header with context and a page number so the builder can rejoin after a
 * break.
 */
export async function buildBookletPdf(input: Input): Promise<Uint8Array> {
  const { sequence, pinCount, diameterMm, threadLabel } = input;
  const palette = input.palette ?? [];
  const sequenceColors = input.sequenceColors ?? [];
  const multiColor = palette.length > 1;
  const paletteColors = palette.map(hexToPdfRgb);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);

  const colWidthPt = (LETTER_WIDTH_PT - 2 * MARGIN_PT - COL_GAP_PT) / COLS;
  const contentTop = LETTER_HEIGHT_PT - MARGIN_PT - HEADER_HEIGHT_PT;
  const contentBottom = MARGIN_PT;
  const rowsPerCol = Math.floor((contentTop - contentBottom) / ROW_HEIGHT_PT);
  const rowsPerPage = rowsPerCol * COLS;
  const pageCount = Math.ceil(sequence.length / rowsPerPage);

  if (multiColor) {
    drawLegendPage(doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]), {
      font,
      bold,
      palette,
      paletteColors,
      sequenceColors,
      pinCount,
      diameterMm,
      threadLabel,
      stepsTotal: pageCount,
    });
  }

  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
    drawHeader(page, {
      font,
      bold,
      page: p + 1,
      total: pageCount,
      pinCount,
      diameterMm,
      threadLabel,
    });
    const start = p * rowsPerPage;
    for (let r = 0; r < rowsPerPage; r++) {
      const step = start + r;
      if (step >= sequence.length) break;
      const col = Math.floor(r / rowsPerCol);
      const rowInCol = r % rowsPerCol;
      const x = MARGIN_PT + col * (colWidthPt + COL_GAP_PT);
      const y = contentTop - rowInCol * ROW_HEIGHT_PT - ROW_HEIGHT_PT;
      const colorIdx = sequenceColors[step] ?? 0;
      const isBreak = colorIdx < 0;
      drawCell(page, {
        x,
        y,
        width: colWidthPt,
        step,
        nail: sequence[step] ?? 0,
        font,
        bold,
        swatch: multiColor && !isBreak ? paletteColors[colorIdx] ?? null : null,
        isBreak,
      });
    }
  }

  return doc.save();
}

function drawLegendPage(
  page: PDFPage,
  args: {
    font: PDFFont;
    bold: PDFFont;
    palette: readonly string[];
    paletteColors: RGB[];
    sequenceColors: readonly number[];
    pinCount: number;
    diameterMm: number;
    threadLabel: string;
    stepsTotal: number;
  },
) {
  const { font, bold, palette, paletteColors, sequenceColors } = args;
  const ink = rgb(0.08, 0.07, 0.06);
  const muted = rgb(0.4, 0.38, 0.35);
  const top = LETTER_HEIGHT_PT - MARGIN_PT;

  page.drawText("Thread legend", {
    x: MARGIN_PT,
    y: top - 14,
    size: 14,
    font: bold,
    color: ink,
  });
  page.drawText(
    `${args.diameterMm} mm  ·  ${args.pinCount} nails  ·  ${args.threadLabel}`,
    {
      x: MARGIN_PT,
      y: top - 32,
      size: 9,
      font,
      color: muted,
    },
  );
  page.drawText(
    "Each row below is a thread color. The step-by-step sequence pages print a colored dot beside each nail so you know which spool to grab.",
    {
      x: MARGIN_PT,
      y: top - 52,
      size: 9,
      font,
      color: muted,
      maxWidth: LETTER_WIDTH_PT - 2 * MARGIN_PT,
      lineHeight: 12,
    },
  );

  const counts = palette.map(() => 0);
  for (const c of sequenceColors) {
    if (c < 0) continue;
    if (c < counts.length) counts[c] = (counts[c] ?? 0) + 1;
  }

  const rowY0 = top - 96;
  palette.forEach((hex, idx) => {
    const y = rowY0 - idx * 26;
    page.drawRectangle({
      x: MARGIN_PT,
      y: y - 4,
      width: 18,
      height: 18,
      color: paletteColors[idx] ?? rgb(1, 1, 1),
      borderColor: ink,
      borderWidth: 0.5,
    });
    page.drawText(`c${idx}`, {
      x: MARGIN_PT + 28,
      y: y + 2,
      size: 10,
      font: bold,
      color: ink,
    });
    page.drawText(hex, {
      x: MARGIN_PT + 60,
      y: y + 2,
      size: 10,
      font,
      color: muted,
    });
    const label = `${(counts[idx] ?? 0).toLocaleString()} lines`;
    page.drawText(label, {
      x: MARGIN_PT + 140,
      y: y + 2,
      size: 10,
      font,
      color: ink,
    });
  });
}

function drawHeader(
  page: PDFPage,
  args: {
    font: PDFFont;
    bold: PDFFont;
    page: number;
    total: number;
    pinCount: number;
    diameterMm: number;
    threadLabel: string;
  },
) {
  const { font, bold, page: p, total, pinCount, diameterMm, threadLabel } = args;
  const ink = rgb(0.08, 0.07, 0.06);
  const muted = rgb(0.4, 0.38, 0.35);

  const top = LETTER_HEIGHT_PT - MARGIN_PT;
  page.drawText("String art sequence", {
    x: MARGIN_PT,
    y: top - 14,
    size: 12,
    font: bold,
    color: ink,
  });
  const meta = `${diameterMm} mm  ·  ${pinCount} nails  ·  ${threadLabel}`;
  page.drawText(meta, {
    x: MARGIN_PT,
    y: top - 30,
    size: 9,
    font,
    color: muted,
  });
  const pageLabel = `${p} / ${total}`;
  const pageWidth = font.widthOfTextAtSize(pageLabel, 9);
  page.drawText(pageLabel, {
    x: LETTER_WIDTH_PT - MARGIN_PT - pageWidth,
    y: top - 14,
    size: 9,
    font,
    color: muted,
  });
  page.drawLine({
    start: { x: MARGIN_PT, y: top - HEADER_HEIGHT_PT + 8 },
    end: { x: LETTER_WIDTH_PT - MARGIN_PT, y: top - HEADER_HEIGHT_PT + 8 },
    color: ink,
    thickness: 0.5,
  });
}

function drawCell(
  page: PDFPage,
  args: {
    x: number;
    y: number;
    width: number;
    step: number;
    nail: number;
    font: PDFFont;
    bold: PDFFont;
    swatch: RGB | null;
    isBreak?: boolean;
  },
) {
  const { x, y, width, step, nail, font, bold, swatch, isBreak } = args;
  const ink = rgb(0.08, 0.07, 0.06);
  const muted = rgb(0.45, 0.43, 0.4);

  // Checkbox
  page.drawRectangle({
    x,
    y: y + 2,
    width: 10,
    height: 10,
    borderColor: ink,
    borderWidth: 0.6,
  });

  // Step number (muted)
  page.drawText(String(step + 1).padStart(4, "0"), {
    x: x + 16,
    y: y + 3,
    size: 9,
    font,
    color: muted,
  });

  if (isBreak) {
    // Break rows mark a thread cut — the builder finishes the
    // previous run, ties off, and restarts at the nail number
    // shown. The step still counts so the booklet's numbering
    // stays a 1:1 map with `sequence`. Nail is placed right after
    // the label's actual width (plus a small gap) — the previous
    // hard-coded x was narrower than the label itself in Courier 9
    // and the two texts ran into each other.
    const label = "cut · restart at ";
    const labelX = x + 60;
    const labelWidth = font.widthOfTextAtSize(label, 9);
    page.drawText(label, {
      x: labelX,
      y: y + 3,
      size: 9,
      font,
      color: muted,
    });
    page.drawText(String(nail).padStart(3, "0"), {
      x: labelX + labelWidth,
      y: y + 3,
      size: 11,
      font: bold,
      color: ink,
    });
    return;
  }

  // Nail number (bold)
  const nailStr = String(nail).padStart(3, "0");
  page.drawText(nailStr, {
    x: x + 60,
    y: y + 3,
    size: 11,
    font: bold,
    color: ink,
  });

  // Color swatch (only in multi-color booklets)
  if (swatch) {
    page.drawCircle({
      x: x + 92,
      y: y + 7,
      size: 3.5,
      color: swatch,
      borderColor: ink,
      borderWidth: 0.3,
    });
  }

  // Subtle row underline
  page.drawLine({
    start: { x, y },
    end: { x: x + width, y },
    color: rgb(0.88, 0.86, 0.82),
    thickness: 0.3,
  });
}
