const STROKE = "#141311";
const ACCENT = "#D4541F";
const MUTED = "#6B6762";
const LINE = "#e7e3db";
const CREAM = "#f4efe5";

const W = 180;
const H = 140;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className="block h-auto w-full max-w-[180px]"
    >
      {children}
    </svg>
  );
}

function pinPositions(
  count: number,
  radius: number,
  cx: number,
  cy: number,
  startAngle = -Math.PI / 2,
) {
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const angle = startAngle + (i / count) * Math.PI * 2;
    positions.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }
  return positions;
}

/** Step 1: sanded disc + two paint-coat swatches + brush. */
export function BoardArt() {
  return (
    <Frame>
      {/* Disc side profile: outlined disc getting painted */}
      <circle
        cx="54"
        cy="70"
        r="38"
        fill="#e9d9b8"
        stroke={STROKE}
        strokeWidth="1"
      />
      {/* Paint sweep already applied (left half) */}
      <path
        d="M54 32 A38 38 0 0 0 54 108 Z"
        fill={CREAM}
        stroke={STROKE}
        strokeWidth="0.6"
      />
      {/* Sanding marks on bare side */}
      <g stroke={MUTED} strokeWidth="0.5" opacity="0.6">
        <path d="M62 48 L76 48" />
        <path d="M62 54 L84 54" />
        <path d="M62 60 L82 60" />
        <path d="M62 68 L86 68" />
        <path d="M62 76 L82 76" />
        <path d="M62 84 L78 84" />
        <path d="M62 92 L74 92" />
      </g>

      {/* Brush above */}
      <g transform="translate(104 28) rotate(18)">
        <rect
          x="0"
          y="14"
          width="38"
          height="6"
          rx="1"
          fill="#c9a16b"
          stroke={STROKE}
          strokeWidth="0.8"
        />
        <rect
          x="36"
          y="13"
          width="4"
          height="8"
          fill={MUTED}
          stroke={STROKE}
          strokeWidth="0.5"
        />
        <path
          d="M40 14 L54 10 L54 22 L40 20 Z"
          fill={CREAM}
          stroke={STROKE}
          strokeWidth="0.6"
        />
        {/* Drip */}
        <path
          d="M52 22 Q54 28 52 32 Q50 28 52 22"
          fill={CREAM}
          stroke={STROKE}
          strokeWidth="0.4"
        />
      </g>

      {/* Label "2 coats" */}
      <text
        x="118"
        y="92"
        fontSize="9"
        fill={MUTED}
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        2 coats
      </text>
      <path
        d="M112 96 L100 84"
        stroke={MUTED}
        strokeWidth="0.6"
        strokeLinecap="round"
      />
    </Frame>
  );
}

/** Step 2: paper template on disc, every-tenth nails emphasized with numbers. */
export function NailsArt() {
  const cx = 64;
  const cy = 68;
  const R = 44;
  const N = 40;

  return (
    <Frame>
      {/* Paper template halo */}
      <circle
        cx={cx}
        cy={cy}
        r={R + 8}
        fill="#faf8f4"
        stroke={LINE}
        strokeDasharray="3 2"
        strokeWidth="0.8"
      />
      {/* Cream painted disc */}
      <circle cx={cx} cy={cy} r={R} fill={CREAM} stroke={STROKE} strokeWidth="0.8" />

      {/* Nails at every position: accent for registration (every 10th) */}
      {Array.from({ length: N }, (_, i) => {
        const angle = -Math.PI / 2 + (i / N) * Math.PI * 2;
        const px = cx + Math.cos(angle) * R;
        const py = cy + Math.sin(angle) * R;
        const isRegister = i % 10 === 0;
        if (isRegister) {
          return (
            <g key={i}>
              <circle cx={px} cy={py} r="2.4" fill={ACCENT} />
              <circle cx={px} cy={py} r="0.8" fill={STROKE} />
            </g>
          );
        }
        return (
          <circle
            key={i}
            cx={px}
            cy={py}
            r="1"
            fill={STROKE}
            fillOpacity="0.55"
          />
        );
      })}

      {/* Numbers at every 10th outside disc */}
      {[0, 10, 20, 30].map((n) => {
        const i = n;
        const angle = -Math.PI / 2 + (i / N) * Math.PI * 2;
        const lx = cx + Math.cos(angle) * (R + 10);
        const ly = cy + Math.sin(angle) * (R + 10);
        return (
          <text
            key={n}
            x={lx}
            y={ly}
            fontSize="7.5"
            fill={MUTED}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="Berkeley Mono, ui-monospace, monospace"
          >
            {n}
          </text>
        );
      })}

      {/* Hammer tapping a registration nail (top nail at angle 0) */}
      <g transform={`translate(${cx + 8} ${cy - R - 14}) rotate(35)`}>
        <rect
          x="0"
          y="7"
          width="26"
          height="3"
          rx="1"
          fill="#8b6b3c"
          stroke={STROKE}
          strokeWidth="0.6"
        />
        <path
          d="M24 3 L36 3 L38 6 L38 11 L36 14 L24 14 L22 11 L22 6 Z"
          fill={MUTED}
          stroke={STROKE}
          strokeWidth="0.7"
        />
      </g>

      {/* Label */}
      <text
        x="120"
        y="76"
        fontSize="9"
        fill={MUTED}
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        register
      </text>
      <text
        x="120"
        y="88"
        fontSize="9"
        fill={MUTED}
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        every 10th
      </text>
      <text
        x="120"
        y="100"
        fontSize="9"
        fill={MUTED}
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        then fill in
      </text>
    </Frame>
  );
}

/** Step 3: close-up of a single nail with a double-loop anchor and tail. */
export function AnchorArt() {
  return (
    <Frame>
      {/* Board surface */}
      <rect x="0" y="88" width={W} height="16" fill="#f0ead8" />
      <line
        x1="0"
        y1="88"
        x2={W}
        y2="88"
        stroke={LINE}
        strokeWidth="0.8"
      />
      {/* Wood grain */}
      <g stroke={MUTED} strokeOpacity="0.3" strokeWidth="0.4">
        <path d="M0 94 L180 94" />
        <path d="M0 100 L180 100" />
      </g>

      {/* Single large nail standing tall */}
      <rect
        x="84"
        y="34"
        width="10"
        height="54"
        rx="1"
        fill="#c8c2b5"
        stroke={STROKE}
        strokeWidth="0.8"
      />
      {/* Nail head */}
      <ellipse
        cx="89"
        cy="34"
        rx="10"
        ry="3"
        fill="#8a867a"
        stroke={STROKE}
        strokeWidth="0.8"
      />
      {/* Highlight */}
      <line
        x1="85"
        y1="40"
        x2="85"
        y2="80"
        stroke="#f4efe5"
        strokeOpacity="0.5"
        strokeWidth="0.8"
      />

      {/* Double loop of thread around nail, orange thread */}
      <g
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.4"
        strokeLinecap="round"
      >
        {/* First wrap (back to front) */}
        <path d="M78 58 Q70 60 74 66 Q82 68 98 62 Q102 58 96 54 Q86 52 78 58" />
        {/* Second wrap (slightly offset) */}
        <path d="M78 66 Q70 70 76 74 Q86 78 100 70 Q104 66 96 62" />
      </g>
      {/* Glue dot */}
      <circle cx="104" cy="60" r="2.4" fill={ACCENT} opacity="0.45" />
      <circle cx="104" cy="60" r="1.2" fill={ACCENT} />

      {/* Thread tail trailing off */}
      <path
        d="M100 70 Q120 76 150 74"
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Trim scissor mark */}
      <path
        d="M148 70 L156 78 M148 78 L156 70"
        stroke={STROKE}
        strokeWidth="0.8"
        strokeLinecap="round"
      />

      {/* Label */}
      <text
        x="8"
        y="22"
        fontSize="9"
        fill={MUTED}
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        nail 000
      </text>
      <text
        x="118"
        y="90"
        fontSize="8"
        fill={MUTED}
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        3 cm tail
      </text>
    </Frame>
  );
}

/** Step 4: three-nail close-up showing thread wrap direction current → next. */
export function WeaveArt() {
  const A = { x: 36, y: 96 };
  const B = { x: 94, y: 42 };
  const C = { x: 152, y: 96 };

  return (
    <Frame>
      {/* Cream surface */}
      <rect x="0" y="0" width={W} height={H} fill={CREAM} rx="2" />

      {/* Existing thread from before (behind A) */}
      <path
        d={`M4 110 L${A.x - 6} ${A.y - 3}`}
        stroke={STROKE}
        strokeOpacity="0.45"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* Line from A to B (previous line, lighter) */}
      <path
        d={`M${A.x} ${A.y} L${B.x} ${B.y}`}
        stroke={STROKE}
        strokeOpacity="0.55"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* Current line B to C (accent) */}
      <path
        d={`M${B.x} ${B.y} L${C.x} ${C.y}`}
        stroke={ACCENT}
        strokeWidth="1.4"
        strokeLinecap="round"
      />

      {/* Wrap arc around C */}
      <path
        d={`M${C.x} ${C.y} Q${C.x + 10} ${C.y - 4} ${C.x + 6} ${C.y + 6} Q${C.x - 2} ${C.y + 8} ${C.x + 2} ${C.y + 2}`}
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* Thread continuing onward */}
      <path
        d={`M${C.x + 2} ${C.y + 2} Q${C.x + 14} ${C.y + 14} ${C.x + 20} ${C.y + 22}`}
        fill="none"
        stroke={ACCENT}
        strokeOpacity="0.5"
        strokeWidth="1"
        strokeLinecap="round"
        strokeDasharray="2 2"
      />

      {/* Nails */}
      {[A, B, C].map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3.2" fill={STROKE} />
          <circle cx={p.x} cy={p.y} r="1.2" fill={CREAM} />
        </g>
      ))}
      {/* Highlight current nail */}
      <circle
        cx={B.x}
        cy={B.y}
        r="6"
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.2"
      />

      {/* Labels */}
      <text
        x={A.x - 4}
        y={A.y + 18}
        fontSize="8"
        fill={STROKE}
        fillOpacity="0.6"
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        from
      </text>
      <text
        x={B.x - 10}
        y={B.y - 10}
        fontSize="8"
        fill={ACCENT}
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        current
      </text>
      <text
        x={C.x - 4}
        y={C.y + 18}
        fontSize="8"
        fill={STROKE}
        fillOpacity="0.6"
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        next
      </text>
    </Frame>
  );
}

/** Step 5: thread starts on the LEFT of nail 1, wraps 90° CCW down to its
 *  BOTTOM, runs diagonally up to the TOP of nail 2, loops 270° CW around
 *  nail 2 (top → right → bottom → left), and ascends on the LEFT. The
 *  exit tail crosses the diagonal bridge just above-left of nail 2. */
export function WrapArt() {
  const R = 5;
  const n1 = { x: 70, y: 94 };
  const n2 = { x: 115, y: 94 };

  const d = `
    M 65 34
    L 65 94
    A ${R} ${R} 0 0 0 70 99
    L 115 89
    A ${R} ${R} 0 1 1 110 94
    L 110 34
  `;

  return (
    <Frame>
      <path
        d={d}
        fill="none"
        stroke={STROKE}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {[n1, n2].map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={R} fill="#c8c2b5" stroke={STROKE} strokeWidth="0.8" />
          <circle cx={p.x} cy={p.y} r="1.3" fill={STROKE} />
        </g>
      ))}

      <text
        x={W / 2}
        y="14"
        fontSize="9"
        fill={STROKE}
        textAnchor="middle"
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        alternate the wrap side
      </text>
      <text
        x={W / 2}
        y={H - 6}
        fontSize="8"
        fill={MUTED}
        textAnchor="middle"
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        one nail left, the next right
      </text>
    </Frame>
  );
}

/** Step 6: last nail with wraps, knot, glue. */
export function FinishArt() {
  return (
    <Frame>
      {/* Board surface */}
      <rect x="0" y="96" width={W} height="14" fill="#f0ead8" />
      <line x1="0" y1="96" x2={W} y2="96" stroke={LINE} strokeWidth="0.8" />

      {/* Central nail */}
      <rect
        x="82"
        y="40"
        width="10"
        height="56"
        rx="1"
        fill="#c8c2b5"
        stroke={STROKE}
        strokeWidth="0.8"
      />
      <ellipse
        cx="87"
        cy="40"
        rx="11"
        ry="3"
        fill="#8a867a"
        stroke={STROKE}
        strokeWidth="0.8"
      />

      {/* Three wraps */}
      {[58, 66, 74].map((y) => (
        <ellipse
          key={y}
          cx="87"
          cy={y}
          rx="13"
          ry="2.6"
          fill="none"
          stroke={ACCENT}
          strokeWidth="1.4"
        />
      ))}

      {/* Tail to knot */}
      <path
        d="M100 74 Q112 78 120 82"
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.4"
        strokeLinecap="round"
      />

      {/* Simple knot bead */}
      <circle cx="122" cy="82" r="3" fill={ACCENT} />

      {/* Trimmed tail ending with small cross */}
      <path
        d="M125 82 L138 82"
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M136 78 L140 86 M136 86 L140 78"
        stroke={STROKE}
        strokeWidth="0.9"
        strokeLinecap="round"
      />

      {/* Labels */}
      <text
        x="8"
        y="22"
        fontSize="9"
        fill={MUTED}
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        last nail
      </text>
      <text
        x="30"
        y="68"
        fontSize="8"
        fill={MUTED}
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        wraps
      </text>
      <text
        x="112"
        y="72"
        fontSize="8"
        fill={MUTED}
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        knot
      </text>
      <text
        x="128"
        y="94"
        fontSize="8"
        fill={MUTED}
        fontFamily="Berkeley Mono, ui-monospace, monospace"
      >
        trim
      </text>
    </Frame>
  );
}

/** Step 6: troubleshooting — find the bad line, step back, redo from there. */
export function TroubleArt() {
  const cx = 64;
  const cy = 68;
  const R = 48;
  const N = 24;

  const nails = pinPositions(N, R, cx, cy);
  const pin = (i: number) => {
    const p = nails[i];
    if (!p) throw new Error("out of range");
    return p;
  };

  const good: Array<[number, number]> = [
    [0, 9],
    [9, 3],
    [3, 14],
    [14, 6],
    [6, 18],
  ];
  const badFrom = 18;
  const badWrong = 21;
  const badRight = 11;
  const wrongPin = pin(badWrong);
  const rightPin = pin(badRight);
  const fromPin = pin(badFrom);

  return (
    <Frame>
      {/* Disc */}
      <circle cx={cx} cy={cy} r={R} fill={CREAM} stroke={STROKE} strokeWidth="0.8" />

      {/* Prior correct lines, soft dark */}
      <g stroke={STROKE} strokeOpacity="0.45" strokeWidth="0.9" fill="none">
        {good.map(([a, b], i) => {
          const pa = pin(a);
          const pb = pin(b);
          return <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} />;
        })}
      </g>

      {/* The wrong line — accent, dashed to read as "to remove" */}
      <line
        x1={fromPin.x}
        y1={fromPin.y}
        x2={wrongPin.x}
        y2={wrongPin.y}
        stroke={ACCENT}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeDasharray="3 2.5"
      />

      {/* The correct line that replaces it — solid accent */}
      <line
        x1={fromPin.x}
        y1={fromPin.y}
        x2={rightPin.x}
        y2={rightPin.y}
        stroke={ACCENT}
        strokeWidth="1.4"
        strokeLinecap="round"
      />

      {/* Nails ring */}
      {nails.map((p, i) => {
        const flagged = i === badWrong;
        return (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={flagged ? 2 : 1}
              fill={flagged ? ACCENT : STROKE}
              fillOpacity={flagged ? 1 : 0.5}
            />
            {flagged ? (
              <circle
                cx={p.x}
                cy={p.y}
                r="3.6"
                fill="none"
                stroke={ACCENT}
                strokeWidth="0.9"
              />
            ) : null}
          </g>
        );
      })}

      {/* Ring-back arrow: arcs from the wrong nail back to the correct one */}
      <g
        fill="none"
        stroke={STROKE}
        strokeOpacity="0.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d={`M${wrongPin.x - 6} ${wrongPin.y - 2}
              Q${(wrongPin.x + rightPin.x) / 2}
               ${Math.min(wrongPin.y, rightPin.y) - 22}
               ${rightPin.x + 2} ${rightPin.y - 6}`}
          strokeWidth="1.2"
        />
        <path
          d={`M${rightPin.x + 2} ${rightPin.y - 6}
              l 4 -4 m -4 4 l 5 2`}
          strokeWidth="1.2"
        />
      </g>

      {/* Side callout: step back one */}
      <g transform="translate(130 50)">
        <text
          x="0"
          y="0"
          fontSize="9"
          fill={MUTED}
          fontFamily="Berkeley Mono, ui-monospace, monospace"
        >
          skipped
        </text>
        <text
          x="0"
          y="12"
          fontSize="9"
          fill={MUTED}
          fontFamily="Berkeley Mono, ui-monospace, monospace"
        >
          a nail?
        </text>
        <text
          x="0"
          y="30"
          fontSize="9"
          fill={ACCENT}
          fontFamily="Berkeley Mono, ui-monospace, monospace"
        >
          ← 1 step
        </text>
        <text
          x="0"
          y="42"
          fontSize="9"
          fill={MUTED}
          fontFamily="Berkeley Mono, ui-monospace, monospace"
        >
          redo
        </text>
      </g>
    </Frame>
  );
}
