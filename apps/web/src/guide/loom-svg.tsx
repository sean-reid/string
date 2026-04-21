import { useMemo } from "react";

interface Props {
  pinPositions: Float32Array | null;
  imageSize: number;
  pinCount: number;
  sequence: readonly number[];
  currentStep: number;
}

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
  currentStep,
}: Props) {
  const paths = useMemo(() => {
    if (!pinPositions || imageSize <= 0) return [] as string[];
    const batches: string[] = [];
    let current = "";
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
      current += `M${fmt(fx)} ${fmt(fy)}L${fmt(tx)} ${fmt(ty)}`;
      if (i % STROKE_BATCH === 0) {
        batches.push(current);
        current = "";
      }
    }
    if (current) batches.push(current);
    return batches;
  }, [pinPositions, imageSize, sequence, currentStep]);

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

      {/* Thread — light cream with multiply-on-light behaviour via screen blend */}
      <g
        stroke="#f4efe5"
        strokeOpacity={0.42}
        strokeWidth={0.6}
        strokeLinecap="round"
        fill="none"
        style={{ mixBlendMode: "screen" }}
      >
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {/* Guide line to next nail, accent */}
      {currentPin !== undefined && nextPin !== undefined ? (
        <line
          x1={pinPositions[currentPin * 2] ?? 0}
          y1={pinPositions[currentPin * 2 + 1] ?? 0}
          x2={pinPositions[nextPin * 2] ?? 0}
          y2={pinPositions[nextPin * 2 + 1] ?? 0}
          stroke="#D4541F"
          strokeOpacity={0.75}
          strokeWidth={1.4}
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
                stroke="#D4541F"
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
              <circle cx={x} cy={y} r={4} fill="#D4541F" />
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
