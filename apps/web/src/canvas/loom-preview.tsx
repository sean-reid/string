import { useEffect, useRef } from "react";
import { useImageStore } from "@/image/store";

const UNDERLAY_OPACITY = 0.42;
const DISPLAY_CAP = 1024;

/**
 * Phase 1 renderer. Draws the preprocessed bitmap into a circular "loom"
 * mask. Phase 2 replaces this with PixiJS running in an OffscreenCanvas
 * worker once the solver starts emitting lines.
 */
export function LoomPreview() {
  const bitmap = useImageStore((s) => s.bitmap);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;

    const parent = canvas.parentElement;
    const size = Math.min(
      parent?.clientWidth ?? bitmap.width,
      parent?.clientHeight ?? bitmap.height,
      DISPLAY_CAP,
    );
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#0E0D0B";
    ctx.fillRect(0, 0, size, size);

    const radius = size / 2 - 1;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.globalAlpha = UNDERLAY_OPACITY;
    ctx.drawImage(bitmap, 0, 0, size, size);
    ctx.globalAlpha = 1;

    ctx.restore();

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "rgba(231, 227, 219, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, [bitmap]);

  return (
    <canvas
      ref={canvasRef}
      role="presentation"
      aria-hidden="true"
      className="block"
    />
  );
}
