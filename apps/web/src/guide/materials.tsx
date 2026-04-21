import { Fragment } from "react";
import type { Bom } from "./compute";
import { formatDuration } from "./compute";

export function MaterialsList({ bom }: { bom: Bom }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "board", value: bom.boardLabel },
    { label: "nails", value: `${bom.nailCount}` },
    { label: "nail spec", value: bom.nailSpec },
    { label: "nail height", value: `${bom.nailHeightMm} mm above board` },
    {
      label: "thread",
      value: `${bom.threadLabel}, ${bom.threadDiameterMm.toFixed(1)} mm`,
    },
    {
      label: "thread length",
      value: `${bom.totalThreadMeters.toFixed(1)} m (${Math.round(
        bom.totalThreadYards,
      )} yd), with buffer`,
    },
    { label: "spools", value: `${bom.threadSpools}` },
    { label: "lines", value: bom.lineCount.toLocaleString() },
    {
      label: "build time",
      value: `${formatDuration(bom.buildMinutesBeginner)} first · ${formatDuration(bom.buildMinutesExpert)} practised`,
    },
  ];
  return (
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
              i === 0 ? undefined : { borderTop: "1px solid var(--color-line)" }
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
  );
}
