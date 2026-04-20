export function CanvasStage() {
  return (
    <div
      role="img"
      aria-label="Empty loom. Drop an image to begin."
      className="relative flex min-h-[320px] flex-1 items-center justify-center bg-canvas p-6"
    >
      <div className="pointer-events-none select-none text-center text-canvas-muted">
        <p className="font-display text-2xl tracking-tight">Drop an image</p>
        <p className="mt-2 text-sm">or paste one with {"\u2318"}V</p>
      </div>
    </div>
  );
}
