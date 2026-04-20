import { FileDrop } from "@/image/file-drop";
import { SampleGallery } from "@/image/sample-gallery";
import { useImageStore } from "@/image/store";
import { LinesCanvas } from "./lines-canvas";
import { ProgressRail } from "./progress-rail";
import { UnderlayCanvas } from "./underlay-canvas";

export function CanvasStage() {
  const status = useImageStore((s) => s.status);
  const meta = useImageStore((s) => s.meta);
  const hasImage = status === "ready" && meta !== null;

  return (
    <div
      role="img"
      aria-label={
        hasImage
          ? `Loom preview. ${meta.filename ?? "image"} loaded at ${meta.sourceWidth} by ${meta.sourceHeight} pixels.`
          : "Empty loom. Drop an image to begin."
      }
      data-state={hasImage ? "ready" : "empty"}
      className="relative flex min-h-[360px] flex-1 items-center justify-center bg-paper p-6"
    >
      <ProgressRail />
      {hasImage && meta ? (
        <div className="relative aspect-square w-full max-w-[min(100%,90vh)]">
          <UnderlayCanvas />
          <LinesCanvas />
        </div>
      ) : (
        <div className="flex w-full flex-col items-center gap-8">
          <FileDrop />
          <SampleGallery />
        </div>
      )}
    </div>
  );
}
