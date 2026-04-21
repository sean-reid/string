import type { PDFFont, PDFPage } from "pdf-lib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const LETTER_WIDTH_PT = 612;
const LETTER_HEIGHT_PT = 792;
const MARGIN_PT = 40;
const COLS = 2;
const COL_GAP_PT = 16;
const ROW_HEIGHT_PT = 16;
const HEADER_HEIGHT_PT = 44;

interface Input {
  sequence: readonly number[];
  pinCount: number;
  diameterMm: number;
  threadLabel: string;
}

/**
 * Paginated sequence booklet as a real PDF. Two columns of checkbox + step
 * + nail per page, tight but legible on letter. Each page carries a
 * header with context and a page number so the builder can rejoin after a
 * break.
 */
export async function buildBookletPdf(input: Input): Promise<Uint8Array> {
  const { sequence, pinCount, diameterMm, threadLabel } = input;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);

  const colWidthPt = (LETTER_WIDTH_PT - 2 * MARGIN_PT - COL_GAP_PT) / COLS;
  const contentTop = LETTER_HEIGHT_PT - MARGIN_PT - HEADER_HEIGHT_PT;
  const contentBottom = MARGIN_PT;
  const rowsPerCol = Math.floor((contentTop - contentBottom) / ROW_HEIGHT_PT);
  const rowsPerPage = rowsPerCol * COLS;
  const pageCount = Math.ceil(sequence.length / rowsPerPage);

  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
    drawHeader(page, { font, bold, page: p + 1, total: pageCount, pinCount, diameterMm, threadLabel });
    const start = p * rowsPerPage;
    for (let r = 0; r < rowsPerPage; r++) {
      const step = start + r;
      if (step >= sequence.length) break;
      const col = Math.floor(r / rowsPerCol);
      const rowInCol = r % rowsPerCol;
      const x = MARGIN_PT + col * (colWidthPt + COL_GAP_PT);
      const y = contentTop - rowInCol * ROW_HEIGHT_PT - ROW_HEIGHT_PT;
      drawCell(page, {
        x,
        y,
        width: colWidthPt,
        step,
        nail: sequence[step] ?? 0,
        font,
        bold,
      });
    }
  }

  return doc.save();
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
  },
) {
  const { x, y, width, step, nail, font, bold } = args;
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

  // Nail number (bold)
  const nailStr = String(nail).padStart(3, "0");
  page.drawText(nailStr, {
    x: x + 60,
    y: y + 3,
    size: 11,
    font: bold,
    color: ink,
  });

  // Subtle row underline
  page.drawLine({
    start: { x, y },
    end: { x: x + width, y },
    color: rgb(0.88, 0.86, 0.82),
    thickness: 0.3,
  });
}
