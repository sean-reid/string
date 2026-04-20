import { useImageStore } from "@/image/store";

/**
 * Thin indeterminate progress bar at the top of the canvas surface.
 * Visible only while an image is decoding; never blocks the UI.
 */
export function ProgressRail() {
  const status = useImageStore((s) => s.status);
  const visible = status === "decoding";

  return (
    <div
      aria-hidden={!visible}
      className={[
        "pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden transition-opacity duration-150",
        visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
      role="progressbar"
      aria-label="Preparing image"
      aria-busy={visible}
    >
      <div className="h-full w-full bg-line/40">
        <div className="h-full w-1/3 animate-[progress-slide_1.2s_ease-in-out_infinite] bg-accent" />
      </div>
    </div>
  );
}
