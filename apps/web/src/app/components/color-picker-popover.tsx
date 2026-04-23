import { useEffect, useRef, useState } from "react";

interface ColorPickerPopoverProps {
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  /** Pre-curated thread colors shown as quick-pick chips. */
  presets?: string[];
  /** Anchor element used to position the popover. */
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
 * Stylized color picker: a live preview, hex input, native
 * eyedropper/color control for fine picks, and a row of Vrellis-
 * style preset chips. Positioned absolutely over its anchor; closes
 * on outside click or Escape.
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

  useEffect(() => {
    setDraft(value);
  }, [value]);

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

  const commit = (next: string) => {
    const normalized = clampHex(next);
    if (!normalized) return;
    setDraft(normalized);
    onChange(normalized);
  };

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Edit swatch color"
      className="absolute left-0 top-[calc(100%+6px)] z-20 flex w-64 flex-col gap-3 rounded-md border border-line bg-paper p-3 shadow-lg"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-8 w-8 shrink-0 rounded border border-line"
          style={{ backgroundColor: draft || value }}
        />
        <input
          type="color"
          aria-label="Pick exact color"
          value={draft || value}
          onChange={(e) => commit(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-line bg-surface p-0.5"
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
