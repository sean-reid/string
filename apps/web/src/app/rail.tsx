import { useEffect, useCallback } from "react";
import { useImageStore } from "@/image/store";
import { useSolverStore } from "@/solver/store";
import { useViewStore } from "@/solver/view-store";
import { ExportPanel } from "@/export/export-panel";
import {
  BOARDS,
  THREADS,
  deriveSolverParams,
  estimatedBuildHours,
  estimatedThreadMeters,
  minSkipPins,
  threadCoverage,
  type BoardId,
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
            label="Thread"
            value={physical.threadId}
            onChange={(v) => setPhysical({ threadId: v })}
            options={THREAD_OPTIONS}
            disabled={running}
          />
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
