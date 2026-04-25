import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 * Stylized color picker tuned for iOS Safari. The critical detail is
 * that the marker dots are positioned via `transform: translate3d(…)`
 * — a composite-only operation that iOS Safari does NOT throttle
 * during touch gestures. Earlier attempts with `left: %` / `top: %`
 * produced visible position lag (paint kept up via background-color
 * but layout updates were deprioritized while a touch was active),
 * which manifested as the marker drifting away from the finger and
 * showing a position that didn't match the picked color.
 *
 * Drag commits are deferred to release: local hsv updates at the
 * touch-event rate (live preview swatch + hex), but onChange to the
 * parent fires once at touchend / mouseup, so the global solver
 * store doesn't churn through a re-render storm during the drag.
 *
 * Body scroll + touch-action are locked while the popover is open
 * to suppress iOS rubber-band / address-bar gesture animations that
 * also throttle layout.
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
  const svMarkerRef = useRef<HTMLSpanElement | null>(null);
  const hueMarkerRef = useRef<HTMLSpanElement | null>(null);
  const svDragRef = useRef<{ id: number; rect: DOMRect } | null>(null);
  const hueDragRef = useRef<{ id: number; rect: DOMRect } | null>(null);

  const [draft, setDraft] = useState(value);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);
  const [svSize, setSvSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [hueSize, setHueSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Refs let drag handlers always read the latest state without
  // re-binding listeners per render.
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const svSizeRef = useRef(svSize);
  svSizeRef.current = svSize;
  const hueSizeRef = useRef(hueSize);
  hueSizeRef.current = hueSize;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pendingHexRef = useRef<string | null>(null);
  const dragEndAttachedRef = useRef(false);

  const flushPending = () => {
    const hex = pendingHexRef.current;
    pendingHexRef.current = null;
    if (hex) onChangeRef.current(hex);
  };

  // Lock body scroll + touch-action while the picker is open. iOS
  // Safari throttles layout during any touch-driven gesture (address
  // bar collapse, rubber-band, scroll), which would compete with the
  // picker's marker even when there's no real scroll happening.
  useEffect(() => {
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevTouchAction = body.style.touchAction;
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    return () => {
      body.style.overflow = prevOverflow;
      body.style.touchAction = prevTouchAction;
    };
  }, []);

  // Flush any pending drag value on unmount.
  useEffect(
    () => () => {
      flushPending();
    },
    [],
  );

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

  // Measure SV / hue dimensions for transform-based marker positioning.
  useLayoutEffect(() => {
    const sv = svRef.current;
    const hue = hueRef.current;
    const measure = () => {
      if (sv) {
        const r = sv.getBoundingClientRect();
        setSvSize({ width: r.width, height: r.height });
      }
      if (hue) {
        const r = hue.getBoundingClientRect();
        setHueSize({ width: r.width, height: r.height });
      }
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (observer) {
      if (sv) observer.observe(sv);
      if (hue) observer.observe(hue);
    }
    return () => observer?.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const popoverWidth = popoverRef.current?.offsetWidth ?? 256;
      const margin = 12;
      const viewportWidth = Math.min(
        window.innerWidth || Number.MAX_SAFE_INTEGER,
        document.documentElement.clientWidth || Number.MAX_SAFE_INTEGER,
        window.visualViewport?.width ?? Number.MAX_SAFE_INTEGER,
      );
      const minLeft = margin;
      const maxLeft = viewportWidth - popoverWidth - margin;
      let leftViewport = anchorRect.left;
      if (leftViewport > maxLeft) leftViewport = maxLeft;
      if (leftViewport < minLeft) leftViewport = minLeft;
      const topViewport = anchorRect.bottom + 6;
      // We position with `absolute` (not fixed) on iOS 26 — fixed
      // elements there jitter during touch gestures (WebKit bug
      // 297779: visualViewport.offsetTop becomes incorrectly set to
      // 24px during address-bar collapse, and fixed children shift).
      // Body scroll is locked while the popover is open so absolute
      // coords stay aligned with the viewport.
      const top = topViewport + window.scrollY;
      const left = leftViewport + window.scrollX;
      setPlacement({ top, left });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [anchor]);

  const ensureDragEndListener = () => {
    if (dragEndAttachedRef.current) return;
    dragEndAttachedRef.current = true;
    const onEnd = () => {
      dragEndAttachedRef.current = false;
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      window.removeEventListener("mouseup", onEnd);
      flushPending();
    };
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    window.addEventListener("mouseup", onEnd);
  };

  const commitImmediate = (next: string) => {
    const normalized = clampHex(next);
    if (!normalized) return;
    setDraft(normalized);
    setHsv(hexToHsv(normalized));
    pendingHexRef.current = null;
    onChangeRef.current(normalized);
  };

  const commitDrag = (newHsv: Hsv) => {
    const hex = hsvToHex(newHsv);
    setDraft(hex);
    setHsv(newHsv);
    pendingHexRef.current = hex;
    ensureDragEndListener();
  };

  // Direct DOM writes for the marker dots. iOS Safari deprioritizes the
  // composite layer that hosts these elements during a touch gesture —
  // even though setHsv() runs at the touch-event rate, the resulting
  // transform paint can lag the finger by a full second in the worst
  // case. Writing style.transform on every move event puts the visual
  // update onto the same path iOS reserves for input scrolling, which
  // it does NOT throttle, so the marker tracks the finger 1:1 even
  // when React's render pipeline is starved.
  const writeSvMarker = (s: number, v: number, hex: string) => {
    const el = svMarkerRef.current;
    if (!el) return;
    const { width, height } = svSizeRef.current;
    el.style.transform = `translate3d(${s * width}px, ${(1 - v) * height}px, 0) translate(-50%, -50%)`;
    el.style.backgroundColor = hex;
  };

  const writeHueMarker = (h: number, hex: string) => {
    const el = hueMarkerRef.current;
    if (!el) return;
    const { width } = hueSizeRef.current;
    el.style.transform = `translate3d(${(h / 360) * width}px, 0, 0) translate(-50%, -50%)`;
    el.style.backgroundColor = `hsl(${Math.round(h)}, 100%, 50%)`;
    const sv = svRef.current;
    if (sv) sv.style.backgroundColor = `hsl(${Math.round(h)}, 100%, 50%)`;
    const svMarker = svMarkerRef.current;
    if (svMarker) svMarker.style.backgroundColor = hex;
  };

  const applySv = (clientX: number, clientY: number, rect: DOMRect) => {
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    const s = Math.min(1, Math.max(0, x));
    const v = Math.min(1, Math.max(0, 1 - y));
    const next = { ...hsvRef.current, s, v };
    const hex = hsvToHex(next);
    writeSvMarker(s, v, hex);
    commitDrag(next);
  };

  const applyHue = (clientX: number, rect: DOMRect) => {
    const x = (clientX - rect.left) / rect.width;
    const h = Math.min(360, Math.max(0, x * 360));
    const next = { ...hsvRef.current, h };
    const hex = hsvToHex(next);
    writeHueMarker(h, hex);
    commitDrag(next);
  };

  const startTouchDrag = (
    rect: DOMRect,
    identifier: number,
    initialX: number,
    initialY: number,
    apply: (clientX: number, clientY: number, rect: DOMRect) => void,
    clearRef: () => void,
  ) => {
    apply(initialX, initialY, rect);
    const findTouch = (ev: TouchEvent) => {
      for (let i = 0; i < ev.touches.length; i += 1) {
        const t = ev.touches.item(i);
        if (t && t.identifier === identifier) return t;
      }
      return null;
    };
    const onMove = (ev: TouchEvent) => {
      const t = findTouch(ev);
      if (!t) return;
      // preventDefault keeps iOS Safari from reclassifying this touch
      // as a scroll/zoom gesture mid-drag, which throttles touchmove
      // delivery. Requires { passive: false } on the listener.
      if (ev.cancelable) ev.preventDefault();
      apply(t.clientX, t.clientY, rect);
    };
    const cleanup = () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEndEvt);
      window.removeEventListener("touchcancel", onEndEvt);
      clearRef();
    };
    const onEndEvt = (ev: TouchEvent) => {
      if (ev.touches.length === 0 || !findTouch(ev)) cleanup();
    };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEndEvt);
    window.addEventListener("touchcancel", onEndEvt);
  };

  const startMouseDrag = (
    rect: DOMRect,
    apply: (clientX: number, clientY: number, rect: DOMRect) => void,
    clearRef: () => void,
  ) => {
    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      apply(ev.clientX, ev.clientY, rect);
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEndEvt);
      clearRef();
    };
    const onEndEvt = () => cleanup();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEndEvt);
  };

  const current = clampHex(draft) || value;
  const pureHue = `hsl(${Math.round(hsv.h)}, 100%, 50%)`;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Edit swatch color"
      className="absolute z-50 flex w-64 flex-col gap-3 rounded-md border border-line bg-paper p-3 shadow-lg"
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
          onBlur={() => commitImmediate(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitImmediate(draft);
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
        className="relative h-40 w-full cursor-crosshair touch-none select-none overflow-hidden rounded border border-line"
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
          svDragRef.current = { id: touch.identifier, rect };
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
          svDragRef.current = { id: e.pointerId, rect };
          applySv(e.clientX, e.clientY, rect);
          startMouseDrag(rect, applySv, () => {
            svDragRef.current = null;
          });
        }}
      >
        <span
          ref={svMarkerRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 block h-4 w-4 rounded-full border-2 border-paper shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          style={{
            // Transform-only positioning. iOS Safari deprioritizes
            // layout updates (left/top changes) during touch gestures
            // but always processes composite (transform) updates —
            // this is the difference between a marker that lags the
            // finger and one that tracks it. The drag handlers also
            // overwrite this style directly via svMarkerRef on every
            // touchmove so the marker keeps tracking even when the
            // React render path is starved.
            transform: `translate3d(${hsv.s * svSize.width}px, ${(1 - hsv.v) * svSize.height}px, 0) translate(-50%, -50%)`,
            backgroundColor: current,
            willChange: "transform",
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
          hueDragRef.current = { id: touch.identifier, rect };
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
          hueDragRef.current = { id: e.pointerId, rect };
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
          ref={hueMarkerRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 block h-5 w-2 rounded border-2 border-paper shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          style={{
            transform: `translate3d(${(hsv.h / 360) * hueSize.width}px, 0, 0) translate(-50%, -50%)`,
            backgroundColor: pureHue,
            willChange: "transform",
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
                onClick={() => commitImmediate(p)}
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
    </div>,
    document.body,
  );
}
