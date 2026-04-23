import { useEffect, useCallback, useRef } from "react";
import { useImageStore } from "@/image/store";
import { useSolverStore } from "@/solver/store";
import { ExportPanel } from "@/export/export-panel";
import {
  BOARDS,
  THREADS,
  deriveSolverParams,
  estimatedBuildHours,
  estimatedThreadMeters,
  minSkipPins,
  threadCoverage,
} from "@/solver/physics";
import { Slider } from "@/components/slider";
import { PalettePicker } from "@/app/components/palette-picker";

export function ParameterRail() {
  const imageStatus = useImageStore((s) => s.status);
  const imageHash = useImageStore((s) => s.meta?.hash ?? null);
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

  // Auto-solve on image change. Keyed on image hash with a ref so the
  // solve fires exactly once per distinct image (subsequent runs go
  // through the manual "Generate again" button).
  const lastSolvedHash = useRef<string | null>(null);
  useEffect(() => {
    if (imageStatus !== "ready") return;
    if (!imageHash) return;
    if (solverStatus === "running") return;
    if (lastSolvedHash.current === imageHash) return;
    lastSolvedHash.current = imageHash;
    void start();
  }, [imageStatus, imageHash, solverStatus, start]);

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
          <Slider
            label="Nails"
            min={200}
            max={360}
            step={1}
            value={physical.pinCount}
            onChange={(v) => setPhysical({ pinCount: v })}
            suffix={`${physical.pinCount}`}
            disabled={running}
          />
          <Slider
            label="Lines"
            min={1000}
            max={6000}
            step={100}
            value={physical.lineBudget}
            onChange={(v) => setPhysical({ lineBudget: v })}
            suffix={`${physical.lineBudget.toLocaleString()}`}
            disabled={running}
          />

          <PalettePicker />

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
