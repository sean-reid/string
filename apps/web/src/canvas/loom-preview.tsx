import { useEffect, useRef } from "react";
import { useImageStore } from "@/image/store";
import { useSolverStore } from "@/solver/store";

const UNDERLAY_OPACITY = 0.28;
const DISPLAY_CAP = 1024;
const THREAD_COLOR = "#f1ede4";
const LINE_OPACITY = 0.12;
const LINE_WIDTH = 0.6;

/**
 * Paints the preprocessed underlay and overlays the solver's line sequence
 * on top. Lines are appended incrementally as the solver emits batches, so
 * redraws stay cheap at high line counts.
 */
export function LoomPreview() {
  const bitmap = useImageStore((s) => s.bitmap);
  const sequence = useSolverStore((s) => s.sequence);
  const pinPositions = useSolverStore((s) => s.pinPositions);
  const imageSize = useSolverStore((s) => s.imageSize);
  const generationId = useSolverStore((s) => s.generationId);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawnCountRef = useRef(0);
  const lastGenRef = useRef(0);
  const displaySizeRef = useRef(0);

  // Redraw the underlay whenever the bitmap, solver generation, or layout changes.
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
    displaySizeRef.current = size;

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

    ctx.globalAlpha = UNDERLAY_OPACITY;
    ctx.drawImage(bitmap, 0, 0, size, size);
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.strokeStyle = "#141311";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    drawnCountRef.current = 0;
    lastGenRef.current = generationId;
  }, [bitmap, generationId]);

  // Append new lines incrementally.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pinPositions || imageSize <= 0 || sequence.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = displaySizeRef.current;
    if (size === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const scale = size / imageSize;
    const start = Math.max(1, drawnCountRef.current);
    if (start >= sequence.length) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = THREAD_COLOR;
    ctx.globalAlpha = LINE_OPACITY;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = "round";

    ctx.beginPath();
    for (let i = start; i < sequence.length; i++) {
      const fromIdx = sequence[i - 1];
      const toIdx = sequence[i];
      if (fromIdx === undefined || toIdx === undefined) continue;
      const fx = pinPositions[fromIdx * 2];
      const fy = pinPositions[fromIdx * 2 + 1];
      const tx = pinPositions[toIdx * 2];
      const ty = pinPositions[toIdx * 2 + 1];
      if (
        fx === undefined ||
        fy === undefined ||
        tx === undefined ||
        ty === undefined
      ) {
        continue;
      }
      ctx.moveTo(fx * scale, fy * scale);
      ctx.lineTo(tx * scale, ty * scale);
    }
    ctx.stroke();
    ctx.restore();

    drawnCountRef.current = sequence.length;
  }, [sequence, pinPositions, imageSize]);

  return (
    <canvas
      ref={canvasRef}
      role="presentation"
      aria-hidden="true"
      className="block"
    />
  );
}
