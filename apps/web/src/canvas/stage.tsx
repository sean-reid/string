import { FileDrop } from "@/image/file-drop";
import { useImageStore } from "@/image/store";

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
      className={[
        "relative flex min-h-[360px] flex-1 items-center justify-center p-6 transition-colors",
        hasImage ? "bg-canvas" : "bg-paper",
      ].join(" ")}
    >
      {hasImage ? (
        <div className="pointer-events-none select-none text-center text-canvas-muted">
          <p className="font-display text-2xl tracking-tight">Image ready</p>
          <p className="mt-2 text-sm">
            {meta.previewSize} px preview, {meta.solveSize} px solver input
          </p>
        </div>
      ) : (
        <FileDrop />
      )}
    </div>
  );
}
