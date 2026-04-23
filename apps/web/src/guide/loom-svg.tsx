import { useMemo } from "react";

interface Props {
  pinPositions: Float32Array | null;
  imageSize: number;
  pinCount: number;
  sequence: readonly number[];
  /** Palette index per entry in `sequence`. Same length; optional so
   *  existing callers that have not wired it up keep rendering in mono. */
  sequenceColors?: readonly number[];
  palette?: readonly string[];
  currentStep: number;
}

const DEFAULT_ACCENT = "#D4541F";
const DEFAULT_THREAD = "#141311";

const LABEL_EVERY = 20;
const STROKE_BATCH = 18;

/**
 * Cream loom matching the Compose tab post-Vrellis-flip. Threads render
 * dark on a cream board; a `multiply` blend mode makes stacked crossings
 * progressively darken the board the way physical thread does. Current
 * and next nails get accent rings so the builder's place in the sequence
 * is unambiguous.
 */
export function LoomSvg({
  pinPositions,
  imageSize,
  pinCount,
  sequence,
  sequenceColors,
  palette,
  currentStep,
}: Props) {
  const upcomingColor = DEFAULT_ACCENT;
  const paletteResolved = useMemo(
    () => (palette && palette.length > 0 ? palette : [DEFAULT_THREAD]),
    [palette],
  );
  const batches = useMemo(() => {
    if (!pinPositions || imageSize <= 0)
      return [] as Array<{ d: string; color: string }>;
    const out: Array<{ d: string; color: string }> = [];
    let current = "";
    let currentColor = -1;
    let lengthInRun = 0;
    const flush = () => {
      if (current) {
        out.push({
          d: current,
          color: paletteResolved[currentColor] ?? DEFAULT_THREAD,
        });
        current = "";
        lengthInRun = 0;
      }
    };
    for (let i = 1; i <= currentStep; i++) {
      const from = sequence[i - 1];
      const to = sequence[i];
      if (from === undefined || to === undefined) continue;
      const fx = pinPositions[from * 2];
      const fy = pinPositions[from * 2 + 1];
      const tx = pinPositions[to * 2];
      const ty = pinPositions[to * 2 + 1];
      if (
        fx === undefined ||
        fy === undefined ||
        tx === undefined ||
        ty === undefined
      )
        continue;
      const color = sequenceColors?.[i] ?? 0;
      // BREAK_COLOR (-1) marks a thread-cut jump between disjoint
      // Eulerian walks; don't draw a connecting stroke there.
      if (color < 0) {
        flush();
        currentColor = -1;
        continue;
      }
      if (color !== currentColor) {
        flush();
        currentColor = color;
      }
      current += `M${fmt(fx)} ${fmt(fy)}L${fmt(tx)} ${fmt(ty)}`;
      lengthInRun++;
      if (lengthInRun >= STROKE_BATCH) {
        flush();
      }
    }
    flush();
    return out;
  }, [pinPositions, imageSize, sequence, sequenceColors, currentStep, paletteResolved]);

  if (!pinPositions || imageSize <= 0) {
    return null;
  }

  const size = imageSize;
  const cx = size / 2;
  const cy = size / 2;

  const currentPin = sequence[currentStep];
  const previousPin = currentStep > 0 ? sequence[currentStep - 1] : undefined;
  const nextPin = sequence[currentStep + 1];

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Loom, step ${currentStep + 1} of ${sequence.length}`}
      className="block h-full w-full"
    >
      <defs>
        <radialGradient id="loom-cream-build" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor="#fbf7ee" />
          <stop offset="100%" stopColor="#eee6d6" />
        </radialGradient>
      </defs>

      {/* Cream disc */}
      <circle
        cx={cx}
        cy={cy}
        r={size / 2 - 3}
        fill="url(#loom-cream-build)"
        stroke="#141311"
        strokeWidth={1}
      />

      {/* Thread. Multiply blend so stacked dark crossings progressively
          darken the cream the way physical string art does. */}
      <g
        strokeOpacity={0.42}
        strokeWidth={0.6}
        strokeLinecap="round"
        fill="none"
        style={{ mixBlendMode: "multiply" }}
      >
        {batches.map((batch, i) => (
          <path key={i} d={batch.d} stroke={batch.color} />
        ))}
      </g>

      {/* Guide line to next nail in accent color. */}
      {currentPin !== undefined && nextPin !== undefined ? (
        <line
          x1={pinPositions[currentPin * 2] ?? 0}
          y1={pinPositions[currentPin * 2 + 1] ?? 0}
          x2={pinPositions[nextPin * 2] ?? 0}
          y2={pinPositions[nextPin * 2 + 1] ?? 0}
          stroke={upcomingColor}
          strokeOpacity={0.85}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      ) : null}

      {/* Nails — light dots, accent for current/next */}
      {Array.from({ length: pinCount }, (_, i) => {
        const x = pinPositions[i * 2] ?? 0;
        const y = pinPositions[i * 2 + 1] ?? 0;
        const isCurrent = i === currentPin;
        const isPrevious = i === previousPin;
        const isNext = i === nextPin;
        if (isCurrent) {
          return <circle key={i} cx={x} cy={y} r={5} fill="#141311" />;
        }
        if (isNext) {
          return (
            <g key={i}>
              <circle
                cx={x}
                cy={y}
                r={9}
                fill="none"
                stroke={upcomingColor}
                strokeWidth={2}
              >
                <animate
                  attributeName="r"
                  from="7"
                  to="12"
                  dur="1.2s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  from="1"
                  to="0.3"
                  dur="1.2s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle cx={x} cy={y} r={4} fill={upcomingColor} />
            </g>
          );
        }
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={isPrevious ? 2.8 : 1.4}
            fill="#141311"
            fillOpacity={isPrevious ? 0.85 : 0.35}
          />
        );
      })}

      {/* Labels, every tenth pin, outside the disc in muted dark */}
      {Array.from({ length: pinCount }, (_, i) => {
        if (i % LABEL_EVERY !== 0) return null;
        const x = pinPositions[i * 2] ?? 0;
        const y = pinPositions[i * 2 + 1] ?? 0;
        const angle = Math.atan2(y - cy, x - cx);
        const labelRadius = size / 2 - 22;
        const lx = cx + labelRadius * Math.cos(angle);
        const ly = cy + labelRadius * Math.sin(angle);
        return (
          <text
            key={`l${i}`}
            x={lx}
            y={ly}
            fontSize={12}
            fill="#141311"
            fillOpacity={0.55}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="Berkeley Mono, ui-monospace, monospace"
          >
            {i}
          </text>
        );
      })}
    </svg>
  );
}

function fmt(v: number): string {
  return v.toFixed(1);
}
