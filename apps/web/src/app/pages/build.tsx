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
import { StepDisplay } from "@/guide/step-display";
import { useImageStore } from "@/image/store";
import { useSolverStore } from "@/solver/store";

export function BuildPage() {
  const imageMeta = useImageStore((s) => s.meta);
  const sequence = useSolverStore((s) => s.sequence);
  const pinPositions = useSolverStore((s) => s.pinPositions);
  const imageSize = useSolverStore((s) => s.imageSize);
  const physical = useSolverStore((s) => s.physical);
  const status = useSolverStore((s) => s.status);

  const ready =
    sequence.length > 1 && pinPositions != null && imageSize > 0 && imageMeta;

  const patternId = useMemo(() => {
    if (!imageMeta) return null;
    return `${imageMeta.hash}.${physical.pinCount}.${physical.lineBudget}.${physical.threadId}.${physical.boardId}`;
  }, [imageMeta, physical]);

  const bom = useMemo(
    () => computeBom(physical, sequence, pinPositions, imageSize),
    [physical, sequence, pinPositions, imageSize],
  );

  const loadProgress = useProgressStore((s) => s.load);
  const currentStep = useProgressStore((s) => s.current);
  const advance = useProgressStore((s) => s.advance);
  const back = useProgressStore((s) => s.back);
  const autoPlay = useAutoPlay();
  const [announce, setAnnounce] = useState(false);

  useEffect(() => {
    if (patternId && sequence.length > 0) {
      loadProgress(patternId, sequence.length);
    }
  }, [patternId, sequence.length, loadProgress]);

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
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,480px)_minmax(0,1fr)] md:items-start">
        <div className="flex items-start justify-center">
          <div className="aspect-square w-full max-w-[480px]">
            <LoomSvg
              pinPositions={pinPositions}
              imageSize={imageSize}
              pinCount={physical.pinCount}
              sequence={sequence}
              currentStep={currentStep}
            />
          </div>
        </div>
        <StepDisplay
          sequence={sequence}
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
                  <Printables />
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
