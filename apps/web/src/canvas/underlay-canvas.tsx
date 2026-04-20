import { useEffect, useRef } from "react";
import { useImageStore } from "@/image/store";
import { useViewStore } from "@/solver/view-store";

const UNDERLAY_OPACITY = 0.2;
const DISPLAY_CAP = 1024;

/**
 * Bottom layer of the loom. Only paints the preprocessed image under a
 * circular mask. Independent of the solver state so toggling Show Source
 * never touches the thread layer.
 */
export function UnderlayCanvas() {
  const bitmap = useImageStore((s) => s.bitmap);
  const showSource = useViewStore((s) => s.showSource);
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

    ctx.fillStyle = "#0E0D0B";
    ctx.fillRect(0, 0, size, size);

    if (bitmap && showSource) {
      ctx.globalAlpha = UNDERLAY_OPACITY;
      ctx.drawImage(bitmap, 0, 0, size, size);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    ctx.strokeStyle = "#141311";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, [bitmap, showSource]);

  return (
    <canvas
      ref={canvasRef}
      role="presentation"
      aria-hidden="true"
      className="absolute inset-0 m-auto block"
    />
  );
}
