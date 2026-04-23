import { useCallback, useEffect, useRef, useState } from "react";
import { useImageStore } from "@/image/store";
import { useSolverStore } from "@/solver/store";
import { getSolverWorker } from "@/solver/worker-client";
import {
  DEFAULT_THREAD_COLOR,
  MAX_PALETTE_SIZE,
  paletteToSrgbBytes,
  srgbBytesToHex,
} from "@/solver/physics";
import { ColorPickerPopover } from "./color-picker-popover";

/**
 * Row of rounded-corner thread swatches. `[+]` appends the best
 * next color for the current image via `suggestNextColor`; clicking
 * a swatch opens a stylized picker; `(×)` removes a slot (min 1).
 * "Auto-pick all" replaces the palette wholesale with the OKLab
 * k-means extractor's output.
 */
export function PalettePicker() {
  const palette = useSolverStore((s) => s.physical.palette);
  const setPhysical = useSolverStore((s) => s.setPhysical);
  const solverStatus = useSolverStore((s) => s.status);
  const imageStatus = useImageStore((s) => s.status);
  const imageMeta = useImageStore((s) => s.meta);
  const colorRgba = useImageStore((s) => s.colorRgba);
  const imageSize = imageMeta?.size ?? 0;
  const faceBox = imageMeta?.faceBox ?? null;
  const seed = useSolverStore((s) => s.seed);

  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<"suggest" | "auto" | null>(null);
  const anchorRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const hasImage = imageStatus === "ready" && !!colorRgba && imageSize > 0;
  const running = solverStatus === "running";
  const lockedByRun = running;

  useEffect(() => {
    anchorRefs.current.length = palette.length;
  }, [palette.length]);

  const updatePalette = useCallback(
    (next: string[]) => {
      const clean = next
        .slice(0, MAX_PALETTE_SIZE)
        .filter((c) => typeof c === "string" && c.length > 0);
      const safe = clean.length > 0 ? clean : [DEFAULT_THREAD_COLOR];
      setPhysical({ palette: safe });
    },
    [setPhysical],
  );

  const handleEdit = useCallback(
    (index: number, hex: string) => {
      const next = [...palette];
      next[index] = hex;
      updatePalette(next);
    },
    [palette, updatePalette],
  );

  const handleRemove = useCallback(
    (index: number) => {
      if (palette.length <= 1) return;
      const next = palette.filter((_, i) => i !== index);
      setEditing(null);
      updatePalette(next);
    },
    [palette, updatePalette],
  );

  const handleAdd = useCallback(async () => {
    if (palette.length >= MAX_PALETTE_SIZE) return;
    if (!hasImage || !colorRgba) {
      // No image yet — seed with a sensible preset to let the user
      // experiment with the picker before uploading.
      updatePalette([...palette, "#b81c1c"]);
      return;
    }
    setBusy("suggest");
    try {
      const remote = getSolverWorker();
      const existing = paletteToSrgbBytes(palette);
      const face = faceBox
        ? { x: faceBox.x, y: faceBox.y, w: faceBox.w, h: faceBox.h }
        : null;
      const next = await remote.suggestNextColor(
        new Uint8Array(colorRgba),
        imageSize,
        existing,
        face,
      );
      const [hex] = srgbBytesToHex(next);
      updatePalette([...palette, hex ?? "#b81c1c"]);
    } finally {
      setBusy(null);
    }
  }, [palette, hasImage, colorRgba, imageSize, faceBox, updatePalette]);

  const handleAutoPickAll = useCallback(async () => {
    if (!hasImage || !colorRgba) return;
    setBusy("auto");
    try {
      const remote = getSolverWorker();
      const face = faceBox
        ? { x: faceBox.x, y: faceBox.y, w: faceBox.w, h: faceBox.h }
        : null;
      const k = Math.max(2, palette.length);
      const bytes = await remote.extractPalette(
        new Uint8Array(colorRgba),
        imageSize,
        k,
        seed,
        face,
      );
      const hexes = srgbBytesToHex(bytes);
      if (hexes.length > 0) {
        updatePalette(hexes);
      }
    } finally {
      setBusy(null);
    }
  }, [hasImage, colorRgba, imageSize, faceBox, seed, palette.length, updatePalette]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink">Thread colors</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {palette.length} / {MAX_PALETTE_SIZE}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {palette.map((color, i) => {
          const isEditing = editing === i;
          return (
            <div key={i} className="relative">
              <button
                ref={(el) => {
                  anchorRefs.current[i] = el;
                }}
                type="button"
                aria-label={`Edit swatch ${i + 1} (${color})`}
                aria-haspopup="dialog"
                aria-expanded={isEditing}
                disabled={lockedByRun}
                onClick={() => setEditing(isEditing ? null : i)}
                className={[
                  "relative h-8 w-8 rounded border transition",
                  isEditing
                    ? "border-ink ring-2 ring-ink/30"
                    : "border-line hover:border-ink",
                  lockedByRun ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                ].join(" ")}
                style={{ backgroundColor: color }}
              />
              {palette.length > 1 && !lockedByRun && (
                <button
                  type="button"
                  aria-label={`Remove swatch ${i + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(i);
                  }}
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-paper text-[10px] leading-none text-muted transition hover:border-ink hover:text-ink"
                >
                  ×
                </button>
              )}
              {isEditing && (
                <ColorPickerPopover
                  value={color}
                  onChange={(hex) => handleEdit(i, hex)}
                  onClose={() => setEditing(null)}
                  anchor={anchorRefs.current[i] ?? null}
                />
              )}
            </div>
          );
        })}

        {palette.length < MAX_PALETTE_SIZE && !lockedByRun && (
          <button
            type="button"
            aria-label="Add thread color"
            disabled={busy === "suggest"}
            onClick={() => void handleAdd()}
            className="flex h-8 w-8 items-center justify-center rounded border border-dashed border-line text-sm text-muted transition hover:border-ink hover:text-ink disabled:cursor-wait disabled:opacity-60"
          >
            {busy === "suggest" ? "…" : "+"}
          </button>
        )}
      </div>

      <button
        type="button"
        disabled={!hasImage || lockedByRun || busy === "auto"}
        onClick={() => void handleAutoPickAll()}
        className="inline-flex h-8 items-center justify-center rounded-md border border-line bg-surface px-3 text-xs text-muted transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy === "auto" ? "Choosing colors…" : "Auto-pick all"}
      </button>
    </div>
  );
}
