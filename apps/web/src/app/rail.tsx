import { useEffect, useCallback } from "react";
import { useImageStore } from "@/image/store";
import { useSolverStore } from "@/solver/store";
import { useViewStore } from "@/solver/view-store";
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
  type BoardId,
  type PaletteMode,
  type ThreadId,
} from "@/solver/physics";
import { Segmented } from "@/components/segmented";
import { Slider } from "@/components/slider";

const BOARD_OPTIONS: Array<{ value: BoardId; label: string }> = [
  { value: "b12", label: "12 in" },
  { value: "b16", label: "16 in" },
  { value: "b20", label: "20 in" },
  { value: "b24", label: "24 in" },
];

const THREAD_OPTIONS: Array<{ value: ThreadId; label: string }> = [
  { value: "polyester", label: "Polyester" },
  { value: "dmcFloss", label: "Embroidery" },
  { value: "crochetCotton", label: "Cotton #10" },
];

const PALETTE_MODE_OPTIONS: Array<{ value: PaletteMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "manual", label: "Manual" },
];

export function ParameterRail() {
  const imageStatus = useImageStore((s) => s.status);
  const physical = useSolverStore((s) => s.physical);
  const setPhysical = useSolverStore((s) => s.setPhysical);
  const solverStatus = useSolverStore((s) => s.status);
  const linesDrawn = useSolverStore((s) => s.linesDrawn);
  const lineBudget = useSolverStore((s) => s.lineBudget);
  const start = useSolverStore((s) => s.start);
  const cancel = useSolverStore((s) => s.cancel);
  const showSource = useViewStore((s) => s.showSource);
  const toggleSource = useViewStore((s) => s.toggleSource);
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
          <Segmented
            label="Board"
            value={physical.boardId}
            onChange={(v) => setPhysical({ boardId: v })}
            options={BOARD_OPTIONS}
            disabled={running}
          />
          <Segmented
            label="Thread type"
            value={physical.threadId}
            onChange={(v) => setPhysical({ threadId: v })}
            options={THREAD_OPTIONS}
            disabled={running}
          />
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
          <Slider
            label="Min chord"
            min={0.05}
            max={0.5}
            step={0.01}
            value={physical.minChordPct}
            onChange={(v) => setPhysical({ minChordPct: v })}
            suffix={`${Math.round(physical.minChordPct * 100)}%`}
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
            <label className="mt-1 flex items-center justify-between text-sm text-muted">
              <span>Show source</span>
              <input
                type="checkbox"
                checked={showSource}
                onChange={toggleSource}
                className="h-4 w-4 cursor-pointer accent-ink"
                aria-label="Show source image underlay"
              />
            </label>
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

function PalettePicker({ disabled }: { disabled: boolean }) {
  const physical = useSolverStore((s) => s.physical);
  const setPhysical = useSolverStore((s) => s.setPhysical);
  const storePalette = useSolverStore((s) => s.palette);

  // A persisted session that predates the palette picker can have
  // paletteMode / paletteCount missing. Treat that as "auto" with the
  // current palette length so the picker still renders and the user
  // can adjust. The migration in solver/store.ts fills these in on next
  // load, but the guard keeps the UI from vanishing on the first render
  // of an in-flight rehydrate.
  const mode: PaletteMode = physical.paletteMode ?? "auto";
  const paletteCount =
    physical.paletteCount ?? Math.max(1, physical.palette?.length ?? 1);
  const previewPalette =
    mode === "auto" ? storePalette : physical.palette;
  const count =
    mode === "auto"
      ? paletteCount
      : Math.max(
          1,
          Math.min(physical.palette?.length ?? paletteCount, MAX_PALETTE_SIZE),
        );

  const setMode = (next: PaletteMode) => {
    if (next === mode) return;
    if (next === "manual") {
      // Seed manual from whatever palette we last had so the user starts
      // with a reasonable row instead of an empty one.
      const seed =
        storePalette.length >= paletteCount
          ? storePalette.slice(0, paletteCount)
          : ensureLength(
              storePalette.length ? storePalette : [defaultSwatch()],
              paletteCount,
            );
      setPhysical({ paletteMode: "manual", palette: seed, paletteCount });
    } else {
      setPhysical({ paletteMode: "auto", paletteCount });
    }
  };

  const setCount = (next: number) => {
    const clamped = Math.max(1, Math.min(next, MAX_PALETTE_SIZE));
    if (mode === "auto") {
      setPhysical({ paletteCount: clamped });
    } else {
      const current = physical.palette;
      const resized = ensureLength(current, clamped);
      setPhysical({ palette: resized, paletteCount: clamped });
    }
  };

  const updateSwatch = (index: number, hex: string) => {
    if (mode !== "manual") return;
    const next = (physical.palette ?? []).slice();
    next[index] = hex;
    setPhysical({ palette: next });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted">
          Colors
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {count} of {MAX_PALETTE_SIZE}
        </span>
      </div>
      <Segmented
        label="Palette mode"
        hideLabel
        value={mode}
        onChange={setMode}
        options={PALETTE_MODE_OPTIONS}
        disabled={disabled}
      />
      <Slider
        label={mode === "auto" ? "Palette size" : "Swatches"}
        min={1}
        max={MAX_PALETTE_SIZE}
        step={1}
        value={count}
        onChange={setCount}
        suffix={`${count}`}
        disabled={disabled}
      />
      <SwatchRow
        mode={mode}
        palette={previewPalette}
        count={count}
        onSwatchChange={updateSwatch}
        disabled={disabled}
      />
      {mode === "auto" ? (
        <p className="text-[11px] text-muted">
          Palette is derived from the image with k-means each time you
          generate. Hit Generate to refresh the preview.
        </p>
      ) : (
        <p className="text-[11px] text-muted">
          Pick the exact thread colors you own. Tap a swatch to edit.
        </p>
      )}
    </div>
  );
}

function SwatchRow({
  mode,
  palette,
  count,
  onSwatchChange,
  disabled,
}: {
  mode: PaletteMode;
  palette: readonly string[];
  count: number;
  onSwatchChange: (index: number, hex: string) => void;
  disabled: boolean;
}) {
  const entries = ensureLength(palette.length ? palette : [defaultSwatch()], count);
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((hex, idx) => {
        if (mode === "manual") {
          return (
            <label
              key={idx}
              className="relative h-7 w-7 overflow-hidden rounded-md border border-line"
              style={{ background: hex }}
              title={hex}
            >
              <input
                type="color"
                value={hex}
                onChange={(e) => onSwatchChange(idx, e.target.value)}
                disabled={disabled}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label={`Swatch ${idx + 1}: ${hex}`}
              />
            </label>
          );
        }
        return (
          <span
            key={idx}
            aria-label={`Auto swatch ${idx + 1}: ${hex}`}
            title={hex}
            className="h-7 w-7 rounded-md border border-line"
            style={{ background: hex }}
          />
        );
      })}
    </div>
  );
}

function defaultSwatch(): string {
  return "#f4efe5";
}

function ensureLength(palette: readonly string[], length: number): string[] {
  if (palette.length === length) return palette.slice();
  if (palette.length > length) return palette.slice(0, length);
  const fill = palette.length > 0 ? palette[palette.length - 1]! : defaultSwatch();
  return [...palette, ...Array.from({ length: length - palette.length }, () => fill)];
}
