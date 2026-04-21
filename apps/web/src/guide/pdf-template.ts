import type { PDFFont, PDFPage } from "pdf-lib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;
const POINTS_PER_MM = POINTS_PER_INCH / MM_PER_INCH;
const LETTER_WIDTH_PT = 612;
const LETTER_HEIGHT_PT = 792;
const LETTER_MARGIN_PT = 18; // 0.25"
const PRINTABLE_W_PT = LETTER_WIDTH_PT - 2 * LETTER_MARGIN_PT;
const PRINTABLE_H_PT = LETTER_HEIGHT_PT - 2 * LETTER_MARGIN_PT;

interface Input {
  pinPositions: Float32Array;
  imageSize: number;
  pinCount: number;
  diameterMm: number;
  boardLabel: string;
}

function mm(pts: number): number {
  return pts * POINTS_PER_MM;
}

/**
 * Emits a 1:1 scale nail placement template as a PDF. If the disc fits on
 * a letter page it uses a single page. If not, the disc is tiled into as
 * many letter pages as needed, with a 10 mm overlap and cut-alignment
 * marks so the builder can trim and tape the pages together.
 */
export async function buildTemplatePdf(input: Input): Promise<Uint8Array> {
  const { pinPositions, imageSize, pinCount, diameterMm, boardLabel } = input;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);

  const scale = mm(diameterMm) / imageSize; // points per image unit
  const diameterPt = mm(diameterMm);

  const overlapMm = 10;
  const tileWMm = diameterMm <= PRINTABLE_W_PT / POINTS_PER_MM ? diameterMm : PRINTABLE_W_PT / POINTS_PER_MM;
  const tileHMm = diameterMm <= PRINTABLE_H_PT / POINTS_PER_MM ? diameterMm : PRINTABLE_H_PT / POINTS_PER_MM;
  const cols = Math.max(1, Math.ceil((diameterMm - overlapMm) / (tileWMm - overlapMm)));
  const rows = Math.max(1, Math.ceil((diameterMm - overlapMm) / (tileHMm - overlapMm)));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const page = doc.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT]);
      const centerTileXMm = col * (tileWMm - overlapMm);
      const centerTileYMm = row * (tileHMm - overlapMm);

      // Offset used when drawing the disc into this page.
      const xOffsetPt = LETTER_MARGIN_PT - mm(centerTileXMm);
      const yOffsetPt = LETTER_HEIGHT_PT - LETTER_MARGIN_PT - mm(diameterMm - centerTileYMm);

      drawDiscCropped(page, {
        xOffsetPt,
        yOffsetPt,
        diameterPt,
        pinPositions,
        imageSize,
        pinCount,
        scale,
        font,
        bold,
      });

      drawRegistrationMarks(page);
      drawLegend(page, {
        font,
        bold,
        row,
        col,
        rows,
        cols,
        boardLabel,
        pinCount,
      });
    }
  }

  return doc.save();
}

interface DiscArgs {
  xOffsetPt: number;
  yOffsetPt: number;
  diameterPt: number;
  pinPositions: Float32Array;
  imageSize: number;
  pinCount: number;
  scale: number;
  font: PDFFont;
  bold: PDFFont;
}

function drawDiscCropped(
  page: PDFPage,
  args: DiscArgs,
) {
  const { xOffsetPt, yOffsetPt, diameterPt, pinPositions, imageSize, pinCount, scale, font } = args;
  const ink = rgb(0, 0, 0);

  const cxImg = imageSize / 2;
  const cyImg = imageSize / 2;
  const radiusPt = diameterPt / 2;
  const cxPt = xOffsetPt + cxImg * scale;
  const cyPt = yOffsetPt + (imageSize - cyImg) * scale;

  // Circle outline
  page.drawCircle({
    x: cxPt,
    y: cyPt,
    size: radiusPt,
    borderColor: ink,
    borderWidth: 0.4,
    color: undefined,
  });

  // Center crosshair
  page.drawLine({
    start: { x: cxPt - 3, y: cyPt },
    end: { x: cxPt + 3, y: cyPt },
    color: ink,
    thickness: 0.3,
  });
  page.drawLine({
    start: { x: cxPt, y: cyPt - 3 },
    end: { x: cxPt, y: cyPt + 3 },
    color: ink,
    thickness: 0.3,
  });
  page.drawCircle({
    x: cxPt,
    y: cyPt,
    size: 0.7,
    color: ink,
  });

  for (let i = 0; i < pinCount; i++) {
    const ix = pinPositions[i * 2] ?? 0;
    const iy = pinPositions[i * 2 + 1] ?? 0;
    const px = xOffsetPt + ix * scale;
    const py = yOffsetPt + (imageSize - iy) * scale;
    if (
      px < -2 ||
      py < -2 ||
      px > LETTER_WIDTH_PT + 2 ||
      py > LETTER_HEIGHT_PT + 2
    ) {
      continue;
    }
    const isDecade = i % 10 === 0;
    page.drawCircle({
      x: px,
      y: py,
      size: isDecade ? 1.2 : 0.7,
      color: ink,
    });
    if (isDecade) {
      const angle = Math.atan2(iy - cyImg, ix - cxImg);
      const labelOffset = 9;
      const lx = px + labelOffset * Math.cos(angle);
      const ly = py - labelOffset * Math.sin(angle);
      const label = String(i);
      const fontSize = 6;
      const labelWidth = font.widthOfTextAtSize(label, fontSize);
      page.drawText(label, {
        x: lx - labelWidth / 2,
        y: ly - fontSize / 2,
        size: fontSize,
        font,
        color: ink,
      });
    }
  }
}

function drawRegistrationMarks(page: PDFPage) {
  const len = 6;
  const ink = rgb(0, 0, 0);
  const corners: Array<[number, number]> = [
    [LETTER_MARGIN_PT, LETTER_MARGIN_PT],
    [LETTER_WIDTH_PT - LETTER_MARGIN_PT, LETTER_MARGIN_PT],
    [LETTER_MARGIN_PT, LETTER_HEIGHT_PT - LETTER_MARGIN_PT],
    [LETTER_WIDTH_PT - LETTER_MARGIN_PT, LETTER_HEIGHT_PT - LETTER_MARGIN_PT],
  ];
  for (const corner of corners) {
    const x = corner[0];
    const y = corner[1];
    page.drawLine({
      start: { x: x - len, y },
      end: { x: x + len, y },
      color: ink,
      thickness: 0.3,
    });
    page.drawLine({
      start: { x, y: y - len },
      end: { x, y: y + len },
      color: ink,
      thickness: 0.3,
    });
  }
}

interface LegendArgs {
  font: PDFFont;
  bold: PDFFont;
  row: number;
  col: number;
  rows: number;
  cols: number;
  boardLabel: string;
  pinCount: number;
}

function drawLegend(page: PDFPage, args: LegendArgs) {
  const { font, bold, row, col, rows, cols, boardLabel, pinCount } = args;
  const ink = rgb(0.1, 0.1, 0.1);

  const lines: Array<{ text: string; font: PDFFont; size: number }> = [
    { text: "Nail template", font: bold, size: 10 },
    { text: `${boardLabel}  ·  ${pinCount} nails`, font, size: 9 },
    {
      text: rows * cols === 1
        ? "Print at 100%, verify 50 mm ruler, tape to the wood disc."
        : `Tile ${col + 1} / ${cols}, row ${row + 1} / ${rows}. Overlap and align by the cross marks.`,
      font,
      size: 8,
    },
  ];
  let y = LETTER_HEIGHT_PT - LETTER_MARGIN_PT - 14;
  for (const line of lines) {
    page.drawText(line.text, {
      x: LETTER_MARGIN_PT + 6,
      y,
      size: line.size,
      font: line.font,
      color: ink,
    });
    y -= line.size + 3;
  }

  // Calibration ruler, 50 mm, near bottom right.
  const rulerStartX = LETTER_WIDTH_PT - LETTER_MARGIN_PT - mm(50) - 4;
  const rulerY = LETTER_MARGIN_PT + 18;
  page.drawLine({
    start: { x: rulerStartX, y: rulerY },
    end: { x: rulerStartX + mm(50), y: rulerY },
    color: ink,
    thickness: 0.8,
  });
  for (let tick = 0; tick <= 50; tick += 10) {
    const tx = rulerStartX + mm(tick);
    page.drawLine({
      start: { x: tx, y: rulerY - 2 },
      end: { x: tx, y: rulerY + 2 },
      color: ink,
      thickness: 0.5,
    });
  }
  page.drawText("0", {
    x: rulerStartX - 4,
    y: rulerY + 4,
    size: 7,
    font,
    color: ink,
  });
  page.drawText("50 mm", {
    x: rulerStartX + mm(50) - 16,
    y: rulerY + 4,
    size: 7,
    font,
    color: ink,
  });
}
