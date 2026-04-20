import { useEffect, useRef } from "react";
import { useSolverStore } from "@/solver/store";
import { BOARDS, THREADS, threadCoverage } from "@/solver/physics";

const DISPLAY_CAP = 1024;
const THREAD_COLOR = "#f4efe5";
const LINE_WIDTH = 0.9;
// Each stroke() call composites as one shape, so overlaps within a batch
// don't stack. Multiple batches composite over each other, giving the
// diminishing-returns curve we want. Keeping batches small keeps the
// remount-repaint visually identical to the live generation.
const STROKE_BATCH = 16;

/**
 * Top layer of the loom. Appends new thread lines as the solver emits
 * batches. The underlay canvas sits behind this one, so Show Source
 * toggling never forces a repaint of the sequence.
 */
export function LinesCanvas() {
  const sequence = useSolverStore((s) => s.sequence);
  const pinPositions = useSolverStore((s) => s.pinPositions);
  const imageSize = useSolverStore((s) => s.imageSize);
  const generationId = useSolverStore((s) => s.generationId);
  const physical = useSolverStore((s) => s.physical);
  const coverage = threadCoverage(
    THREADS[physical.threadId],
    BOARDS[physical.boardId],
  );
  // Source-over compositing: each stroke's alpha blends onto the
  // current canvas, giving the physical diminishing-returns curve
  // (brightness = 1 - (1 - alpha)^N after N passes).
  const lineOpacity = coverage;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawnCountRef = useRef(0);
  const lastGenRef = useRef(-1);
  const displaySizeRef = useRef(0);

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

    // Reset when the generation changes (new image or new solver run).
    if (lastGenRef.current !== generationId) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      drawnCountRef.current = 0;
      lastGenRef.current = generationId;
      displaySizeRef.current = size;
    } else if (displaySizeRef.current === 0) {
      displaySizeRef.current = size;
    }

    if (!pinPositions || imageSize <= 0 || sequence.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scale = displaySizeRef.current / imageSize;
    const start = Math.max(1, drawnCountRef.current);
    if (start >= sequence.length) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = THREAD_COLOR;
    ctx.globalAlpha = lineOpacity;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = "round";

    let batchSize = 0;
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
      batchSize++;
      if (batchSize >= STROKE_BATCH) {
        ctx.stroke();
        ctx.beginPath();
        batchSize = 0;
      }
    }
    if (batchSize > 0) ctx.stroke();
    ctx.restore();

    drawnCountRef.current = sequence.length;
  }, [sequence, pinPositions, imageSize, generationId, lineOpacity]);

  return (
    <canvas
      ref={canvasRef}
      role="presentation"
      aria-hidden="true"
      className="absolute inset-0 m-auto block"
    />
  );
}
