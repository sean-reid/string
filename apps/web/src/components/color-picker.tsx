import { useEffect, useMemo, useRef, useState } from "react";

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
}

/**
 * Stylized HSV color picker. A hue rail + saturation/value square
 * with live preview, built from the app's design tokens — no native
 * `<input type="color">` that ignores the theme.
 *
 * Renders into a floating popover anchored by the parent. Dismisses
 * on outside click or Escape.
 */
export function ColorPicker({ value, onChange, onClose }: ColorPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, s, v] = useMemo(() => hexToHsv(value), [value]);
  const [draft, setDraft] = useState<[number, number, number]>([h, s, v]);

  useEffect(() => {
    setDraft([h, s, v]);
  }, [h, s, v]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  const apply = (next: [number, number, number]) => {
    setDraft(next);
    onChange(hsvToHex(next[0], next[1], next[2]));
  };

  const draftHex = hsvToHex(draft[0], draft[1], draft[2]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Color picker"
      // Positioned below the whole palette row rather than any single
      // swatch, so the popover doesn't fall off either edge of the
      // rail regardless of which swatch is being edited.
      className="absolute left-0 right-0 top-full z-20 mt-3 flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted">
          Thread color
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close color picker"
          className="flex h-5 w-5 items-center justify-center rounded text-xs leading-none text-muted transition hover:bg-line/50 hover:text-ink"
        >
          ×
        </button>
      </div>
      <SvSquare h={draft[0]} s={draft[1]} v={draft[2]} onChange={apply} />
      <HueRail h={draft[0]} onChange={(h) => apply([h, draft[1], draft[2]])} />
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-7 w-7 shrink-0 rounded-md border border-line shadow-sm"
          style={{ background: draftHex }}
        />
        <input
          aria-label="Hex code"
          className="w-full min-w-0 flex-1 rounded-md border border-line bg-paper px-2 py-1.5 font-mono text-xs uppercase tabular-nums text-ink focus:border-ink focus:outline-none"
          value={draftHex}
          onChange={(e) => {
            const next = e.target.value;
            if (/^#[0-9a-fA-F]{6}$/.test(next)) {
              const [nh, ns, nv] = hexToHsv(next);
              apply([nh, ns, nv]);
            } else {
              setDraft((prev) => prev);
            }
          }}
        />
      </div>
    </div>
  );
}

function SvSquare({
  h,
  s,
  v,
  onChange,
}: {
  h: number;
  s: number;
  v: number;
  onChange: (next: [number, number, number]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromEvent = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ns = clamp01((clientX - rect.left) / rect.width);
    const nv = clamp01(1 - (clientY - rect.top) / rect.height);
    onChange([h, ns, nv]);
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Saturation and value"
      aria-valuenow={Math.round(s * 100)}
      tabIndex={0}
      className="relative h-40 w-full cursor-crosshair touch-none overflow-hidden rounded-md border border-line shadow-inner"
      style={{
        background: `
          linear-gradient(to top, #000, transparent),
          linear-gradient(to right, #fff, ${hsvToHex(h, 1, 1)})
        `,
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setFromEvent(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (dragging.current) setFromEvent(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
        style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
      />
    </div>
  );
}

function HueRail({
  h,
  onChange,
}: {
  h: number;
  onChange: (h: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromEvent = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nh = clamp01((clientX - rect.left) / rect.width);
    onChange(nh);
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Hue"
      aria-valuenow={Math.round(h * 360)}
      tabIndex={0}
      className="relative h-4 w-full cursor-pointer touch-none rounded-md border border-line shadow-inner"
      style={{
        background:
          "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setFromEvent(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) setFromEvent(e.clientX);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded border-2 border-white shadow"
        style={{ left: `${h * 100}%` }}
      />
    </div>
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function hexToHsv(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m || !m[1]) return [0, 0, 0];
  const body = m[1];
  const r = parseInt(body.slice(0, 2), 16) / 255;
  const g = parseInt(body.slice(2, 4), 16) / 255;
  const b = parseInt(body.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, s, v];
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const hp = h * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  const to = (n: number) =>
    Math.max(0, Math.min(255, Math.round((n + m) * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}
