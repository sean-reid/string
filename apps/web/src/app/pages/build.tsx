import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useAutoPlay } from "@/guide/auto-play";
import { computeBom } from "@/guide/compute";
import { GuideTabs } from "@/guide/guide-tabs";
import { Instructions } from "@/guide/instructions";
import { LoomSvg } from "@/guide/loom-svg";
import { MaterialsList } from "@/guide/materials";
import { Printables } from "@/guide/printables";
import { useProgressStore } from "@/guide/progress-store";
import { regroupByColor } from "@/guide/regroup";
import { StepDisplay } from "@/guide/step-display";
import { useImageStore } from "@/image/store";
import { useSolverStore } from "@/solver/store";

export function BuildPage() {
  const imageMeta = useImageStore((s) => s.meta);
  const sequence = useSolverStore((s) => s.sequence);
  const sequenceColors = useSolverStore((s) => s.sequenceColors);
  const palette = useSolverStore((s) => s.palette);
  const pinPositions = useSolverStore((s) => s.pinPositions);
  const imageSize = useSolverStore((s) => s.imageSize);
  const physical = useSolverStore((s) => s.physical);
  const status = useSolverStore((s) => s.status);

  const ready =
    sequence.length > 1 && pinPositions != null && imageSize > 0 && imageMeta;

  // Solver emits interleaved chords — every step it picks whatever
  // thread reduces residual the most, so colors jump around. For the
  // physical build we regroup by palette index (dark → light since the
  // palette is already sorted that way), preserving within-color order.
  // The Compose preview stays interleaved; only the build guide uses
  // this view.
  const regrouped = useMemo(
    () => regroupByColor(sequence, sequenceColors),
    [sequence, sequenceColors],
  );
  const buildSequence = regrouped.sequence;
  const buildColors = regrouped.colors;

  const patternId = useMemo(() => {
    if (!imageMeta) return null;
    return `${imageMeta.hash}.${physical.pinCount}.${physical.lineBudget}.${physical.threadId}.${physical.boardId}`;
  }, [imageMeta, physical]);

  const bom = useMemo(
    () =>
      computeBom(
        physical,
        buildSequence,
        pinPositions,
        imageSize,
        buildColors,
        palette,
      ),
    [physical, buildSequence, pinPositions, imageSize, buildColors, palette],
  );

  const loadProgress = useProgressStore((s) => s.load);
  const currentStep = useProgressStore((s) => s.current);
  const advance = useProgressStore((s) => s.advance);
  const back = useProgressStore((s) => s.back);
  const autoPlay = useAutoPlay();
  const [announce, setAnnounce] = useState(false);

  useEffect(() => {
    if (patternId && buildSequence.length > 0) {
      loadProgress(patternId, buildSequence.length);
    }
  }, [patternId, buildSequence.length, loadProgress]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        autoPlay.toggle();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        advance();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back, autoPlay]);

  if (!ready) {
    return (
      <section
        aria-label="Construction guide"
        className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-10"
      >
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-3xl tracking-tight">Build guide</h1>
          <p className="font-mono text-xs text-muted">
            {status === "running"
              ? "Your pattern is still generating. The guide opens as soon as it finishes."
              : "Generate a pattern first and it appears here."}
          </p>
        </header>
        <Link to="/" className="text-sm text-ink hover:text-accent">
          Go to Compose →
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-label="Construction guide"
      className="mx-auto flex w-full max-w-[1180px] flex-col gap-10 px-6 pb-20 pt-8 sm:px-10"
    >
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl leading-tight tracking-tight">
          Build guide
        </h1>
        <p className="font-mono text-xs tabular-nums text-muted">
          {physical.pinCount.toLocaleString()} nails ·{" "}
          {bom.totalThreadMeters.toFixed(0)} m thread ·{" "}
          {bom.threadSpools} {bom.threadSpools === 1 ? "spool" : "spools"} ·{" "}
          {bom.lineCount.toLocaleString()} lines
        </p>
        <div
          className="mt-1 flex items-center gap-2 font-mono text-xs text-muted"
          aria-label="Thread colors"
        >
          {palette.map((hex, i) => (
            <span
              key={`${i}-${hex}`}
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full border border-line"
              style={{ backgroundColor: hex }}
            />
          ))}
          <span>
            {palette.length === 1
              ? "one thread on cream board"
              : `${palette.length} threads on cream board`}
          </span>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,480px)_minmax(0,1fr)] md:items-start">
        <div className="flex items-start justify-center">
          <div className="aspect-square w-full max-w-[480px]">
            <LoomSvg
              pinPositions={pinPositions}
              imageSize={imageSize}
              pinCount={physical.pinCount}
              sequence={buildSequence}
              sequenceColors={buildColors}
              palette={palette}
              currentStep={currentStep}
            />
          </div>
        </div>
        <StepDisplay
          sequence={buildSequence}
          playing={autoPlay.playing}
          onTogglePlay={autoPlay.toggle}
          announce={announce}
          onToggleAnnounce={() => setAnnounce((a) => !a)}
        />
      </div>

      <div className="border-t border-line pt-8">
        <GuideTabs
          tabs={[
            {
              id: "materials",
              label: "Materials",
              content: (
                <div className="flex flex-col gap-10">
                  <MaterialsList bom={bom} />
                  <Printables
                    sequence={buildSequence}
                    sequenceColors={buildColors}
                  />
                </div>
              ),
            },
            {
              id: "instructions",
              label: "How to build it",
              content: <Instructions />,
            },
          ]}
        />
      </div>
    </section>
  );
}
