import { useEffect, useCallback, useState } from "react";
import { useImageStore } from "@/image/store";
import { useSolverStore } from "@/solver/store";
import { ExportPanel } from "@/export/export-panel";
import {
  BOARDS,
  MAX_PALETTE_SIZE,
  THREADS,
  deriveSolverParams,
  estimatedBuildHours,
  estimatedThreadMeters,
  minSkipPins,
  threadCoverage,
} from "@/solver/physics";
import { Slider } from "@/components/slider";
import { ColorPicker } from "@/components/color-picker";

export function ParameterRail() {
  const imageStatus = useImageStore((s) => s.status);
  const physical = useSolverStore((s) => s.physical);
  const setPhysical = useSolverStore((s) => s.setPhysical);
  const solverStatus = useSolverStore((s) => s.status);
  const linesDrawn = useSolverStore((s) => s.linesDrawn);
  const lineBudget = useSolverStore((s) => s.lineBudget);
  const start = useSolverStore((s) => s.start);
  const cancel = useSolverStore((s) => s.cancel);
  const resetImage = useImageStore((s) => s.reset);
  const resetSolver = useSolverStore((s) => s.reset);

  const startOver = useCallback(() => {
    cancel();
    resetSolver();
    resetImage();
  }, [cancel, resetSolver, resetImage]);

  useEffect(() => {
    if (imageStatus !== "ready") return;
    if (solverStatus !== "idle") return;
    void start();
  }, [imageStatus, solverStatus, start]);

  useEffect(() => {
    if (solverStatus !== "running") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [solverStatus, cancel]);

  const hasImage = imageStatus === "ready";
  const running = solverStatus === "running";
  const board = BOARDS[physical.boardId];
  const thread = THREADS[physical.threadId];
  const derived = deriveSolverParams(physical);
  const threadMeters = estimatedThreadMeters(physical);
  const buildHours = estimatedBuildHours(physical);
  const minPins = minSkipPins(physical.minChordPct, physical.pinCount);

  return (
    <aside
      aria-label="Parameters"
      className="flex shrink-0 flex-col gap-6 border-t border-line p-6 lg:border-l lg:border-t-0"
    >
      <header>
        <h2 className="font-display text-lg tracking-tight">Parameters</h2>
        {!hasImage ? (
          <p className="text-sm text-muted">
            Controls appear once an image is loaded.
          </p>
        ) : (
          <p className="font-mono text-xs tabular-nums text-muted">
            ~{buildHours} h to build, ~{threadMeters} m of thread
          </p>
        )}
      </header>

      {hasImage && (
        <div className="flex flex-col gap-5">
          <PalettePicker disabled={running} />

          <Slider
            label="Nails"
            min={128}
            max={360}
            step={1}
            value={physical.pinCount}
            onChange={(v) => setPhysical({ pinCount: v })}
            suffix={`${physical.pinCount}`}
            disabled={running}
          />
          <Slider
            label="Lines"
            min={500}
            max={6000}
            step={50}
            value={physical.lineBudget}
            onChange={(v) => setPhysical({ lineBudget: v })}
            suffix={`${physical.lineBudget.toLocaleString()}`}
            disabled={running}
          />

          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-muted">
            <dt>thread</dt>
            <dd className="text-ink">{thread.diameterMm.toFixed(1)} mm</dd>
            <dt>px size</dt>
            <dd className="text-ink">
              {(board.diameterMm / 700).toFixed(2)} mm
            </dd>
            <dt>opacity</dt>
            <dd className="text-ink">
              {threadCoverage(thread, board).toFixed(2)}
            </dd>
            <dt>min skip</dt>
            <dd className="text-ink">{minPins} pins</dd>
          </dl>

          <div className="mt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => (running ? cancel() : void start())}
              className="inline-flex h-10 items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-paper transition hover:bg-accent"
              disabled={!hasImage}
            >
              {running
                ? "Cancel"
                : solverStatus === "done"
                  ? "Generate again"
                  : "Generate"}
            </button>
            <button
              type="button"
              onClick={startOver}
              className="inline-flex h-9 items-center justify-center rounded-md border border-line bg-surface px-4 text-sm text-muted transition hover:border-ink hover:text-ink"
            >
              New image
            </button>
            {running && (
              <p className="font-mono text-xs tabular-nums text-muted">
                {linesDrawn.toLocaleString()} /{" "}
                {derived.line_budget.toLocaleString()}
              </p>
            )}
            {solverStatus === "done" && (
              <p className="font-mono text-xs tabular-nums text-muted">
                done, {linesDrawn.toLocaleString()} lines
              </p>
            )}
            {solverStatus === "cancelled" && (
              <p className="font-mono text-xs tabular-nums text-muted">
                stopped at {linesDrawn.toLocaleString()} /{" "}
                {lineBudget.toLocaleString()}
              </p>
            )}
          </div>

          <div className="mt-2 border-t border-line pt-4">
            <ExportPanel />
          </div>
        </div>
      )}
    </aside>
  );
}

/**
 * Palette editor. Each color is a swatch with an X in its top-right
 * corner that removes it from the palette; clicking the body opens a
 * stylized color picker to edit it. After the last swatch a dotted "+"
 * box adds a new color — auto-seeded to whatever the most recent solve
 * suggested (or black if no suggestion is known). Up to
 * MAX_PALETTE_SIZE total.
 */
function PalettePicker({ disabled }: { disabled: boolean }) {
  const physical = useSolverStore((s) => s.physical);
  const setPhysical = useSolverStore((s) => s.setPhysical);
  const suggestionsBySize = useSolverStore((s) => s.suggestionsBySize);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const palette = physical.palette?.length
    ? physical.palette
    : [defaultSwatch()];

  /** Return the image-derived palette of size k, or an empty array if
   *  suggestions haven't been computed yet (pre-solve). */
  const suggestionsAt = (k: number): string[] =>
    suggestionsBySize[Math.max(1, Math.min(k, MAX_PALETTE_SIZE))] ?? [];

  const updateAt = (index: number, hex: string) => {
    const next = palette.slice();
    next[index] = hex;
    setPhysical({ palette: next });
  };

  const removeAt = (index: number) => {
    if (palette.length <= 1) return;
    const next = palette.slice();
    next.splice(index, 1);
    setPhysical({ palette: next });
  };

  const addSwatch = () => {
    if (palette.length >= MAX_PALETTE_SIZE) return;
    // Ask the extractor for a palette one size larger than the user's
    // current one and use whichever entry of the larger set isn't
    // already in the user's palette. That way the added color is the
    // "what would you pick if you had one more slot?" answer, not
    // just the next prefix of some fixed-size extract. Falls back to
    // black if extractions haven't run yet.
    const larger = suggestionsAt(palette.length + 1);
    const unused = larger.find((hex) => !palette.includes(hex));
    const seed = unused ?? defaultSwatch();
    setPhysical({ palette: [...palette, seed] });
  };

  const autoPickAll = () => {
    // Replace the whole user palette with the best image-derived
    // palette AT THE USER'S CURRENT SIZE — an FPS run seeded with
    // k=palette.length rather than the first N picks of the k=6
    // extract. The two are different: FPS-at-3 picks three vertices
    // maximally spread in RGB, FPS-at-6 prefixed to 3 gives the
    // three darkest. The former is what the user wants.
    const size = Math.max(1, Math.min(palette.length, MAX_PALETTE_SIZE));
    const take = suggestionsAt(size);
    if (take.length === 0) return;
    setPhysical({ palette: take.slice(0, size) });
  };

  const canAutoPick = suggestionsAt(palette.length).length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted">
          Colors
        </span>
        <div className="flex items-baseline gap-3">
          <button
            type="button"
            onClick={autoPickAll}
            disabled={disabled || !canAutoPick}
            className="font-mono text-[11px] uppercase tracking-wide text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Auto-pick
          </button>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {palette.length} of {MAX_PALETTE_SIZE}
          </span>
        </div>
      </div>
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          {palette.map((hex, idx) => (
            <SwatchButton
              key={idx}
              hex={hex}
              index={idx}
              canRemove={palette.length > 1}
              disabled={disabled}
              onOpen={() => setEditingIndex(idx)}
              onRemove={() => {
                removeAt(idx);
                if (editingIndex === idx) setEditingIndex(null);
              }}
            />
          ))}
          {palette.length < MAX_PALETTE_SIZE && (
            <button
              type="button"
              onClick={addSwatch}
              disabled={disabled}
              aria-label="Add thread color"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-line text-muted transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true" className="text-lg leading-none">
                +
              </span>
            </button>
          )}
        </div>
        {editingIndex !== null && !disabled && palette[editingIndex] && (
          <ColorPicker
            value={palette[editingIndex]!}
            onChange={(h) => updateAt(editingIndex, h)}
            onClose={() => setEditingIndex(null)}
          />
        )}
      </div>
    </div>
  );
}

function SwatchButton({
  hex,
  index,
  canRemove,
  disabled,
  onOpen,
  onRemove,
}: {
  hex: string;
  index: number;
  canRemove: boolean;
  disabled: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        aria-label={`Edit thread color ${index + 1}: ${hex}`}
        className="h-9 w-9 rounded-md border border-line shadow-sm transition hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: hex }}
      />
      {canRemove && !disabled && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove thread color ${index + 1}`}
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-surface text-[10px] leading-none text-muted shadow-sm transition hover:border-ink hover:bg-ink hover:text-paper"
        >
          ×
        </button>
      )}
    </div>
  );
}

function defaultSwatch(): string {
  return "#111111";
}
