interface PrintInput {
  sequence: readonly number[];
  pinCount: number;
  diameterMm: number;
  threadLabel: string;
}

const ROWS_PER_PAGE = 40;
const COLS_PER_ROW = 2;

/**
 * Paginated sequence booklet, designed for letter-size printing. Each page
 * holds two columns of check-box + step + nail rows so a builder can mark
 * off progress on paper.
 */
export function buildSequencePrintHtml(input: PrintInput): string {
  const { sequence, pinCount, diameterMm, threadLabel } = input;
  const perPage = ROWS_PER_PAGE * COLS_PER_ROW;
  const pageCount = Math.ceil(sequence.length / perPage);

  const pages: string[] = [];
  for (let p = 0; p < pageCount; p++) {
    const start = p * perPage;
    const end = Math.min(start + perPage, sequence.length);
    const leftCol: string[] = [];
    const rightCol: string[] = [];
    for (let i = start; i < end; i++) {
      const cell = cellHtml(i, sequence[i] ?? 0);
      if (i - start < ROWS_PER_PAGE) leftCol.push(cell);
      else rightCol.push(cell);
    }
    pages.push(
      `<section class="page">
        <header class="page-header">
          <span class="title">String art sequence</span>
          <span class="meta">${pinCount} nails · ${diameterMm} mm · ${escapeHtml(threadLabel)}</span>
          <span class="page-no">page ${p + 1} / ${pageCount}</span>
        </header>
        <div class="grid">
          <ol class="col" start="${start + 1}">${leftCol.join("")}</ol>
          <ol class="col">${rightCol.join("")}</ol>
        </div>
      </section>`,
    );
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Sequence booklet</title>
  <style>
    @page { size: Letter; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: "Courier New", Courier, monospace; font-size: 10.5pt; line-height: 1.3; }
    .page { page-break-after: always; padding: 0; }
    .page:last-child { page-break-after: auto; }
    .page-header { display: flex; justify-content: space-between; gap: 10mm; border-bottom: 1px solid #111; padding-bottom: 3mm; margin-bottom: 6mm; font-size: 9pt; }
    .title { font-weight: 700; }
    .meta, .page-no { color: #555; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
    .col { list-style: none; padding: 0; margin: 0; }
    .cell { display: grid; grid-template-columns: 6mm 20mm 1fr; align-items: center; padding: 1mm 0; }
    .cell + .cell { border-top: 0.5px solid #ddd; }
    .box { width: 4mm; height: 4mm; border: 1px solid #333; }
    .step { color: #666; letter-spacing: 0.04em; }
    .nail { font-weight: 700; letter-spacing: 0.05em; }
    @media screen {
      body { background: #f2efe8; padding: 18mm 12mm; }
      .page { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.08); padding: 12mm; margin-bottom: 10mm; }
    }
  </style>
</head>
<body>
  ${pages.join("")}
</body>
</html>`;
}

function cellHtml(step: number, nail: number): string {
  return `<li class="cell"><span class="box"></span><span class="step">${String(step + 1).padStart(4, "0")}</span><span class="nail">${String(nail).padStart(3, "0")}</span></li>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
