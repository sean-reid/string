import { Fragment } from "react";
import type { Bom } from "./compute";
import { formatDuration } from "./compute";

export function MaterialsList({ bom }: { bom: Bom }) {
  const multiColor = bom.colors.length > 1;
  const rows: Array<{ label: string; value: string }> = [
    { label: "board", value: bom.boardLabel },
    { label: "nails", value: `${bom.nailCount}` },
    { label: "nail spec", value: bom.nailSpec },
    { label: "nail height", value: `${bom.nailHeightMm} mm above board` },
    {
      label: "thread",
      value: `${bom.threadLabel}, ${bom.threadDiameterMm.toFixed(1)} mm`,
    },
  ];
  if (!multiColor) {
    rows.push(
      {
        label: "thread length",
        value: `${bom.totalThreadMeters.toFixed(1)} m (${Math.round(
          bom.totalThreadYards,
        )} yd), with buffer`,
      },
      { label: "spools", value: `${bom.threadSpools}` },
    );
  }
  rows.push(
    { label: "lines", value: bom.lineCount.toLocaleString() },
    {
      label: "build time",
      value: `${formatDuration(bom.buildMinutesBeginner)} first · ${formatDuration(bom.buildMinutesExpert)} practised`,
    },
  );

  return (
    <div className="flex flex-col gap-6">
      <dl
        className="font-mono text-[13px] leading-relaxed tabular-nums"
        style={{
          display: "grid",
          gridTemplateColumns: "160px 1fr",
          columnGap: "32px",
        }}
      >
        {rows.map((row, i) => (
          <Fragment key={row.label}>
            <dt
              className="py-3.5 text-muted"
              style={
                i === 0
                  ? undefined
                  : { borderTop: "1px solid var(--color-line)" }
              }
            >
              {row.label}
            </dt>
            <dd
              className="py-3.5 text-ink"
              style={{
                textAlign: "left",
                ...(i === 0
                  ? {}
                  : { borderTop: "1px solid var(--color-line)" }),
                minWidth: 0,
              }}
            >
              {row.value}
            </dd>
          </Fragment>
        ))}
      </dl>
      {multiColor ? <ThreadsByColor bom={bom} /> : null}
    </div>
  );
}

function ThreadsByColor({ bom }: { bom: Bom }) {
  const totalYards = Math.round(bom.totalThreadYards);
  return (
    <section
      aria-label="Thread colors"
      className="flex flex-col gap-3 font-mono text-[13px] tabular-nums"
    >
      <header className="flex items-baseline justify-between text-[11px] uppercase tracking-wide text-muted">
        <span>threads by color</span>
        <span>
          {bom.totalThreadMeters.toFixed(1)} m · {totalYards} yd ·{" "}
          {bom.threadSpools} {bom.threadSpools === 1 ? "spool" : "spools"} total
        </span>
      </header>
      <ul className="flex flex-col gap-2">
        {bom.colors.map((entry, idx) => (
          <li
            key={`${entry.color}-${idx}`}
            className="flex items-center gap-4 rounded-md border border-line bg-surface px-3 py-2.5 text-ink"
          >
            <span
              aria-hidden="true"
              className="h-4 w-4 flex-none rounded-sm border border-line"
              style={{ background: entry.color }}
            />
            <span className="flex-1 text-muted">{entry.color}</span>
            <span className="w-24 text-right">
              {entry.meters.toFixed(1)} m
            </span>
            <span className="w-20 text-right">
              {Math.round(entry.yards)} yd
            </span>
            <span className="w-24 text-right">
              {entry.spools > 0
                ? `${entry.spools} ${entry.spools === 1 ? "spool" : "spools"}`
                : "unused"}
            </span>
            <span className="w-24 text-right text-muted">
              {entry.lineCount.toLocaleString()} lines
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
