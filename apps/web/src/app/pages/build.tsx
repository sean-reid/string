import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useAutoPlay } from "@/build/auto-play";
import { computeBom } from "@/build/compute";
import { Instructions } from "@/build/instructions";
import { LoomSvg } from "@/build/loom-svg";
import { MaterialsList } from "@/build/materials";
import { Printables } from "@/build/printables";
import { useProgressStore } from "@/build/progress-store";
import { SideDrawers } from "@/build/side-drawers";
import { StepDisplay } from "@/build/step-display";
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
      if (event.key === " " || event.key === "ArrowRight") {
        event.preventDefault();
        advance();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back]);

  if (!ready) {
    return (
      <section
        aria-label="Construction guide"
        className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6"
      >
        <header>
          <h1 className="font-display text-3xl tracking-tight">
            Construction guide
          </h1>
          <p className="mt-2 text-muted">
            {status === "running"
              ? "Your pattern is still generating. The guide opens as soon as it finishes."
              : "Generate a pattern first and it appears here."}
          </p>
        </header>
        <Link to="/" className="text-accent hover:underline">
          Go to Compose
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-label="Construction guide"
      className="mx-auto flex w-full max-w-[1200px] flex-col gap-12 px-10 pb-20 pt-10"
    >
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl tracking-tight text-ink">
          Construction guide
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
          {physical.pinCount} nails
          {"      \u00b7      "}
          {bom.totalThreadMeters.toFixed(0)} m thread
          {"      \u00b7      "}
          {bom.threadSpools}{" "}
          {bom.threadSpools === 1 ? "spool" : "spools"}
        </p>
      </header>

      <div className="grid gap-12 md:grid-cols-[minmax(0,1fr)_380px] md:items-stretch">
        <div className="flex items-center justify-center">
          <div className="relative aspect-square w-full max-w-[580px] overflow-hidden rounded-[32px] bg-paper ring-1 ring-line/80 shadow-[0_1px_0_rgba(255,255,255,0.6),0_40px_80px_-50px_rgba(20,19,17,0.2)]">
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

      <SideDrawers
        items={[
          {
            id: "materials",
            label: "Materials",
            content: (
              <>
                <MaterialsList bom={bom} />
                <Printables />
              </>
            ),
          },
          {
            id: "instructions",
            label: "How to build it",
            content: <Instructions />,
          },
        ]}
      />
    </section>
  );
}
