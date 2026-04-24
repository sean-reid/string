import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";

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

/**
 * Stylized color picker tailored to the app's design system: HSV
 * saturation-value square + hue bar via `react-colorful`, which has
 * a battle-tested drag implementation on iOS Safari / Android Chrome
 * (mouse + touch events, window-level listeners, single-pointer
 * tracking). Hex input and preset chips are rendered above / below.
 *
 * Positioning: `position: fixed` with JS-computed coordinates so the
 * popover can't widen the page or trigger a horizontal scrollbar. We
 * clamp left against the tightest available viewport measurement so
 * mobile URL-bar / scrollbar variance can't push the popover off-screen.
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
  const [draft, setDraft] = useState(value);
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

  const commit = (next: string) => {
    const normalized = clampHex(next);
    if (!normalized) return;
    setDraft(normalized);
    onChange(normalized);
  };

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
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            }
          }}
          spellCheck={false}
          className="w-full min-w-0 rounded border border-line bg-surface px-2 py-1 font-mono text-xs tabular-nums focus-visible:border-ink focus-visible:outline-none"
        />
      </div>

      <HexColorPicker
        color={current}
        onChange={commit}
        style={{ width: "100%", height: 160 }}
      />

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
                onClick={() => commit(p)}
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
