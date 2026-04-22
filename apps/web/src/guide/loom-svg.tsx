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

const LABEL_EVERY = 20;
const STROKE_BATCH = 18;

/**
 * Dark loom matching the Compose tab. Threads accumulate in light cream
 * on a warm near-black disc so the piece reads the same visual language
 * as the string-art view. The next nail is the only accent element.
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
  const multiColor = (palette?.length ?? 1) > 1;
  const upcomingColor =
    multiColor && palette && sequenceColors
      ? (palette[sequenceColors[currentStep + 1] ?? 0] ?? DEFAULT_ACCENT)
      : DEFAULT_ACCENT;
  const paletteResolved = palette && palette.length > 0 ? palette : ["#f4efe5"];
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
          color: paletteResolved[currentColor] ?? "#f4efe5",
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
        <radialGradient id="loom-dark-build" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor="#151411" />
          <stop offset="100%" stopColor="#0b0a09" />
        </radialGradient>
      </defs>

      {/* Dark disc */}
      <circle
        cx={cx}
        cy={cy}
        r={size / 2 - 3}
        fill="url(#loom-dark-build)"
        stroke="#141311"
        strokeWidth={1}
      />

      {/* Thread. Mono uses screen blend so cream accumulates on the dark
          disc the same way the Compose canvas does; multi-color uses plain
          source-over so darker threads still render visibly. */}
      <g
        strokeOpacity={0.42}
        strokeWidth={0.6}
        strokeLinecap="round"
        fill="none"
        style={multiColor ? undefined : { mixBlendMode: "screen" }}
      >
        {batches.map((batch, i) => (
          <path key={i} d={batch.d} stroke={batch.color} />
        ))}
      </g>

      {/* Guide line to next nail. In mono mode the accent orange is the
          only distinctive color available; in multi-color solves we use
          the actual thread color the builder should grab next. */}
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
          return <circle key={i} cx={x} cy={y} r={5} fill="#F4EFE5" />;
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
            fill="#F4EFE5"
            fillOpacity={isPrevious ? 0.85 : 0.35}
          />
        );
      })}

      {/* Labels, every tenth pin, outside the disc in muted light */}
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
            fill="#F4EFE5"
            fillOpacity={0.35}
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
