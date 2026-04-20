import { useEffect } from "react";
import { useImageStore } from "@/image/store";
import { useSolverStore } from "@/solver/store";
import { Slider } from "@/components/slider";

export function ParameterRail() {
  const imageStatus = useImageStore((s) => s.status);
  const params = useSolverStore((s) => s.params);
  const setParams = useSolverStore((s) => s.setParams);
  const solverStatus = useSolverStore((s) => s.status);
  const linesDrawn = useSolverStore((s) => s.linesDrawn);
  const lineBudget = useSolverStore((s) => s.lineBudget);
  const start = useSolverStore((s) => s.start);
  const cancel = useSolverStore((s) => s.cancel);

  // Auto-generate as soon as an image is ready for the first time.
  useEffect(() => {
    if (imageStatus !== "ready") return;
    if (solverStatus === "running") return;
    if (solverStatus === "done") return;
    void start();
  }, [imageStatus, solverStatus, start]);

  const hasImage = imageStatus === "ready";
  const running = solverStatus === "running";

  const approxThreadMeters = Math.round(
    (params.line_budget * 0.33 * Math.PI) / 2,
  );
  const approxBuildMinutes = Math.round((params.line_budget * 12) / 60);

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
          <p className="text-sm text-muted">
            ~{approxBuildMinutes} min to build, ~{approxThreadMeters} m of thread
          </p>
        )}
      </header>

      {hasImage && (
        <div className="flex flex-col gap-5">
          <Slider
            label="Nails"
            min={128}
            max={360}
            step={1}
            value={params.pin_count}
            onChange={(v) => setParams({ pin_count: v })}
            suffix={`${params.pin_count}`}
            disabled={running}
          />
          <Slider
            label="Lines"
            min={500}
            max={5000}
            step={10}
            value={params.line_budget}
            onChange={(v) => setParams({ line_budget: v })}
            suffix={`${params.line_budget.toLocaleString()}`}
            disabled={running}
          />
          <Slider
            label="Opacity"
            min={0.04}
            max={0.4}
            step={0.005}
            value={params.opacity}
            onChange={(v) => setParams({ opacity: v })}
            suffix={`${Math.round(params.opacity * 100)}%`}
            disabled={running}
          />
          <Slider
            label="Min skip"
            min={0}
            max={40}
            step={1}
            value={params.min_chord_skip}
            onChange={(v) => setParams({ min_chord_skip: v })}
            suffix={`${params.min_chord_skip}`}
            disabled={running}
          />

          <div className="mt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => (running ? cancel() : void start())}
              className="inline-flex h-10 items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-paper transition hover:bg-accent"
              disabled={!hasImage}
            >
              {running ? "Cancel" : solverStatus === "done" ? "Generate again" : "Generate"}
            </button>
            {running && (
              <p className="font-mono text-xs text-muted">
                {linesDrawn.toLocaleString()} / {lineBudget.toLocaleString()}
              </p>
            )}
            {solverStatus === "done" && (
              <p className="font-mono text-xs text-muted">
                done, {linesDrawn.toLocaleString()} lines
              </p>
            )}
            {solverStatus === "cancelled" && (
              <p className="font-mono text-xs text-muted">
                stopped at {linesDrawn.toLocaleString()} / {lineBudget.toLocaleString()}
              </p>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
