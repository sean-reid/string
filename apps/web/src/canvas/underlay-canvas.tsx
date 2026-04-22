import { useEffect, useRef } from "react";

const DISPLAY_CAP = 1024;

/**
 * Bottom layer of the loom: the bare cream fabric board that threads
 * subtract light from. Source-image overlay was dropped — users can
 * always flip back to the image page to see the source; the loom
 * preview is for the string-art rendering itself.
 */
export function UnderlayCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    const size = Math.min(
      parent?.clientWidth ?? DISPLAY_CAP,
      parent?.clientHeight ?? DISPLAY_CAP,
      DISPLAY_CAP,
    );
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const radius = size / 2 - 1;
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = "#F4EFE5";
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    ctx.strokeStyle = "#141311";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="presentation"
      aria-hidden="true"
      className="absolute inset-0 m-auto block"
    />
  );
}
