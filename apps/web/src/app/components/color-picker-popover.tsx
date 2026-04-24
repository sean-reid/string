import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseHexColor } from "@/solver/physics";

interface ColorPickerPopoverProps {
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  /** Pre-curated thread colors shown as quick-pick chips. */
  presets?: string[];
  /** Anchor element used to position the popover and decide when a
   *  pointer-outside event should dismiss it. */
  anchor: HTMLElement | null;
}

const DEFAULT_PRESETS = [
  "#111111",
  "#b81c1c",
  "#d95a1c",
  "#d9a81c",
  "#8a3c2c",
  "#d98282",
  "#1c8850",
  "#3c5a1c",
  "#1c88a8",
  "#1c70d0",
  "#1c3ca8",
  "#5a1ca8",
  "#a81c88",
];

interface Hsv {
  h: number;
  s: number;
  v: number;
}

function clampHex(hex: string): string {
  const trimmed = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const [r, g, b] = [trimmed[1], trimmed[2], trimmed[3]];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-f]{6}$/.test(trimmed)) return `#${trimmed}`;
  return "";
}

function hexToHsv(hex: string): Hsv {
  const rgb = parseHexColor(hex);
  if (!rgb) return { h: 0, s: 0, v: 0 };
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const v = max;
  const s = max === 0 ? 0 : delta / max;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Stylized color picker tailored to the app's design system: no
 * native browser controls, every surface and border uses the same
 * paper / surface / line / ink / muted tokens the rest of the app
 * uses. HSV model — saturation / value square stacked over a hue
 * bar — plus a hex input and a row of Vrellis-style thread presets.
 *
 * Positioning: anchored below its parent at `left: 0`; after mount
 * we measure and apply a horizontal translation so the popover stays
 * inside the viewport even when the anchor is near the right edge.
 * Closes on outside pointer or Escape.
 */
export function ColorPickerPopover({
  value,
  onChange,
  onClose,
  presets = DEFAULT_PRESETS,
  anchor,
}: ColorPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const svRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);
  // Drag uses native window listeners instead of React's synthetic
  // onPointerMove. React's pointermove flows through the root's event
  // delegation and on Android Chrome some events arrive with stale
  // clientX or skipped moves, which produced the "marker jumps to an
  // edge" jitter. Native window listeners bound at pointerdown fire
  // in real event order with the raw event object; we clean them up
  // on pointerup / cancel.
  const svDragRef = useRef<{ pointerId: number; rect: DOMRect } | null>(null);
  const hueDragRef = useRef<{ pointerId: number; rect: DOMRect } | null>(null);
  // Local state is authoritative while the popover is open. Syncing
  // back from `value` on every prop change creates a feedback loop:
  // our own onChange writes to the parent store, the store hands a
  // rounded hex back through `value`, and syncing HSV from that
  // rounded hex fights the user's live drag — the marker dot
  // ping-pongs between the user's latest pointer position and the
  // quantized hex round-trip. The initial useState readers seed
  // from `value` once; everything after is driven locally.
  const [draft, setDraft] = useState(value);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose, anchor]);

  // Position the popover using `fixed` coordinates derived from the
  // anchor's bounding rect. `fixed` takes the popover out of the
  // document flow entirely so it can't extend ancestor widths and
  // trigger a horizontal scrollbar, no matter where the anchor sits.
  // `documentElement.clientWidth` excludes the vertical scrollbar,
  // giving us the true usable viewport width.
  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const popoverWidth = popoverRef.current?.offsetWidth ?? 256;
      const margin = 12;
      // Take the tightest available measurement of the visible
      // viewport. Mobile Chrome/Safari can return different values
      // across these depending on URL-bar state, device-scale, and
      // horizontal overflow elsewhere on the page — using the
      // smallest keeps the popover inside whatever the user can see.
      const viewportWidth = Math.min(
        window.innerWidth || Number.MAX_SAFE_INTEGER,
        document.documentElement.clientWidth || Number.MAX_SAFE_INTEGER,
        window.visualViewport?.width ?? Number.MAX_SAFE_INTEGER,
      );
      const minLeft = margin;
      const maxLeft = viewportWidth - popoverWidth - margin;
      let left = anchorRect.left;
      if (left > maxLeft) left = maxLeft;
      if (left < minLeft) left = minLeft;
      const top = anchorRect.bottom + 6;
      setPlacement({ top, left });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [anchor]);

  // Fresh refs to avoid stale-closure bugs in window listeners: the
  // listeners capture these once on pointerdown, but we want them to
  // always see the latest hsv and onChange without re-binding per
  // render.
  const hsvRef = useRef(hsv);
  const onChangeRef = useRef(onChange);
  hsvRef.current = hsv;
  onChangeRef.current = onChange;

  const commitHex = (next: string) => {
    const normalized = clampHex(next);
    if (!normalized) return;
    setDraft(normalized);
    setHsv(hexToHsv(normalized));
    onChange(normalized);
  };

  const commitHsv = (patch: Partial<Hsv>) => {
    const merged = { ...hsvRef.current, ...patch };
    const hex = hsvToHex(merged);
    setHsv(merged);
    setDraft(hex);
    onChangeRef.current(hex);
  };

  const applySv = (clientX: number, clientY: number, rect: DOMRect) => {
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    const s = Math.min(1, Math.max(0, x));
    const v = Math.min(1, Math.max(0, 1 - y));
    commitHsv({ s, v });
  };

  const applyHue = (clientX: number, rect: DOMRect) => {
    const x = (clientX - rect.left) / rect.width;
    const h = Math.min(360, Math.max(0, x * 360));
    commitHsv({ h });
  };

  /**
   * Touch-events-only drag path. iOS Safari's Pointer Events
   * implementation for touch is unreliable: pointermove can arrive
   * with stale clientX or get skipped, which drove the marker to
   * the extremes during drag. TouchEvent.changedTouches[0].clientX
   * doesn't have that bug — it's the canonical source of truth for
   * touch coordinates on iOS and Android. We identify the drag by
   * `touch.identifier` so a second finger can't hijack it.
   */
  const startTouchDrag = (
    rect: DOMRect,
    identifier: number,
    initialX: number,
    initialY: number,
    apply: (clientX: number, clientY: number, rect: DOMRect) => void,
    onEnd: () => void,
  ) => {
    apply(initialX, initialY, rect);
    const findTouch = (ev: TouchEvent) => {
      for (let i = 0; i < ev.changedTouches.length; i += 1) {
        const t = ev.changedTouches.item(i);
        if (t && t.identifier === identifier) return t;
      }
      return null;
    };
    const onMove = (ev: TouchEvent) => {
      const t = findTouch(ev);
      if (!t) return;
      ev.preventDefault();
      apply(t.clientX, t.clientY, rect);
    };
    const cleanup = () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEndEvt);
      window.removeEventListener("touchcancel", onEndEvt);
      onEnd();
    };
    const onEndEvt = (ev: TouchEvent) => {
      if (!findTouch(ev)) return;
      cleanup();
    };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEndEvt);
    window.addEventListener("touchcancel", onEndEvt);
  };

  /**
   * Mouse-events-only drag path. Pointer events only end up here on
   * desktop (`pointerType === "mouse"`); touch paths are handled by
   * `startTouchDrag`.
   */
  const startMouseDrag = (
    rect: DOMRect,
    apply: (clientX: number, clientY: number, rect: DOMRect) => void,
    onEnd: () => void,
  ) => {
    const onMove = (ev: MouseEvent) => {
      apply(ev.clientX, ev.clientY, rect);
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEndEvt);
      onEnd();
    };
    const onEndEvt = () => cleanup();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEndEvt);
  };

  const pureHue = `hsl(${Math.round(hsv.h)}, 100%, 50%)`;
  const current = clampHex(draft) || value;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Edit swatch color"
      className="fixed z-50 flex w-64 flex-col gap-3 rounded-md border border-line bg-paper p-3 shadow-lg"
      style={{
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        visibility: placement ? "visible" : "hidden",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-8 w-8 shrink-0 rounded border border-line"
          style={{ backgroundColor: current }}
        />
        <input
          type="text"
          aria-label="Hex color"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitHex(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitHex(draft);
            }
          }}
          spellCheck={false}
          className="w-full min-w-0 rounded border border-line bg-surface px-2 py-1 font-mono text-xs tabular-nums focus-visible:border-ink focus-visible:outline-none"
        />
      </div>

      <div
        ref={svRef}
        role="slider"
        aria-label="Saturation and value"
        aria-valuenow={Math.round(hsv.s * 100)}
        tabIndex={0}
        className="relative h-32 w-full cursor-crosshair touch-none select-none overflow-hidden rounded border border-line"
        style={{
          backgroundColor: pureHue,
          backgroundImage:
            "linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0)), linear-gradient(to right, rgba(255,255,255,1), rgba(255,255,255,0))",
        }}
        onTouchStart={(e) => {
          if (svDragRef.current) return;
          const touch = e.changedTouches[0];
          if (!touch) return;
          const rect = e.currentTarget.getBoundingClientRect();
          svDragRef.current = { pointerId: touch.identifier, rect };
          startTouchDrag(
            rect,
            touch.identifier,
            touch.clientX,
            touch.clientY,
            applySv,
            () => {
              svDragRef.current = null;
            },
          );
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") return;
          if (svDragRef.current) return;
          const rect = e.currentTarget.getBoundingClientRect();
          svDragRef.current = { pointerId: e.pointerId, rect };
          applySv(e.clientX, e.clientY, rect);
          startMouseDrag(rect, applySv, () => {
            svDragRef.current = null;
          });
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute block h-3 w-3 rounded-full border-2 border-paper shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor: current,
          }}
        />
      </div>

      <div
        ref={hueRef}
        role="slider"
        aria-label="Hue"
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={0}
        className="relative h-4 w-full cursor-ew-resize touch-none select-none rounded border border-line"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
        }}
        onTouchStart={(e) => {
          if (hueDragRef.current) return;
          const touch = e.changedTouches[0];
          if (!touch) return;
          const rect = e.currentTarget.getBoundingClientRect();
          hueDragRef.current = { pointerId: touch.identifier, rect };
          startTouchDrag(
            rect,
            touch.identifier,
            touch.clientX,
            touch.clientY,
            (x, _y, r) => applyHue(x, r),
            () => {
              hueDragRef.current = null;
            },
          );
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") return;
          if (hueDragRef.current) return;
          const rect = e.currentTarget.getBoundingClientRect();
          hueDragRef.current = { pointerId: e.pointerId, rect };
          applyHue(e.clientX, rect);
          startMouseDrag(
            rect,
            (x, _y, r) => applyHue(x, r),
            () => {
              hueDragRef.current = null;
            },
          );
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 block h-5 w-2 rounded border-2 border-paper shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor: pureHue,
          }}
        />
      </div>

      <div>
        <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">
          Thread presets
        </p>
        <div className="grid grid-cols-7 gap-1">
          {presets.map((p) => {
            const selected = clampHex(p) === clampHex(draft);
            return (
              <button
                key={p}
                type="button"
                aria-label={`Preset ${p}`}
                aria-pressed={selected}
                onClick={() => commitHex(p)}
                className={[
                  "h-6 w-full rounded border transition",
                  selected ? "border-ink" : "border-line hover:border-ink",
                ].join(" ")}
                style={{ backgroundColor: p }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
