import { useCallback } from "react";
import { useImageStore } from "@/image/store";
import { useSolverStore } from "@/solver/store";
import { useViewStore } from "@/solver/view-store";
import {
  BOARDS,
  THREADS,
  threadCoverage,
} from "@/solver/physics";
import { renderPng } from "./png";
import { renderSvg } from "./svg";
import { renderCsv, renderText } from "./sequence";
import { downloadBlob, safeFilename } from "./download";

const THREAD_COLOR = "#f4efe5";
const LINE_WIDTH_PX = 0.9;

export interface ExportActions {
  png: (scale: 1 | 2 | 4) => Promise<void>;
  svg: () => Promise<void>;
  text: () => Promise<void>;
  csv: () => Promise<void>;
  copySequence: () => Promise<void>;
  available: boolean;
}

export function useExports(): ExportActions {
  const bitmap = useImageStore((s) => s.bitmap);
  const imageMeta = useImageStore((s) => s.meta);
  const sequence = useSolverStore((s) => s.sequence);
  const pinPositions = useSolverStore((s) => s.pinPositions);
  const imageSize = useSolverStore((s) => s.imageSize);
  const physical = useSolverStore((s) => s.physical);
  const solverStatus = useSolverStore((s) => s.status);
  const showSource = useViewStore((s) => s.showSource);

  const available =
    solverStatus !== "idle" &&
    sequence.length > 1 &&
    pinPositions != null &&
    imageSize > 0;

  const board = BOARDS[physical.boardId];
  const thread = THREADS[physical.threadId];
  const lineOpacity = threadCoverage(thread, board);

  const stem = imageMeta?.filename
    ? imageMeta.filename.replace(/\.[^.]+$/, "")
    : `string-${physical.boardId}-${physical.threadId}-${physical.lineBudget}`;

  const png = useCallback(
    async (scale: 1 | 2 | 4) => {
      if (!available || !pinPositions) return;
      const blob = await renderPng({
        bitmap,
        showSource,
        sequence,
        pinPositions,
        imageSize,
        threadColor: THREAD_COLOR,
        lineOpacity,
        lineWidth: LINE_WIDTH_PX,
        outputSize: 1024 * scale,
      });
      downloadBlob(blob, safeFilename(`${stem}-${1024 * scale}px`, "png"));
    },
    [available, bitmap, showSource, sequence, pinPositions, imageSize, lineOpacity, stem],
  );

  const svg = useCallback(async () => {
    if (!available || !pinPositions) return;
    const content = renderSvg({
      sequence,
      pinPositions,
      imageSize,
      diameterMm: board.diameterMm,
      threadColor: THREAD_COLOR,
      lineOpacity,
      lineWidthMm: thread.diameterMm,
      backgroundColor: "#0E0D0B",
      pinCount: physical.pinCount,
    });
    const blob = new Blob([content], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, safeFilename(stem, "svg"));
  }, [available, sequence, pinPositions, imageSize, board, lineOpacity, thread, physical, stem]);

  const text = useCallback(async () => {
    if (!available) return;
    const content = renderText(sequence);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, safeFilename(stem, "txt"));
  }, [available, sequence, stem]);

  const csv = useCallback(async () => {
    if (!available) return;
    const content = renderCsv(sequence, {
      pinCount: physical.pinCount,
      diameterMm: board.diameterMm,
      threadLabel: thread.label,
      lineCount: sequence.length - 1,
    });
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, safeFilename(stem, "csv"));
  }, [available, sequence, physical.pinCount, board.diameterMm, thread.label, stem]);

  const copySequence = useCallback(async () => {
    if (!available) return;
    await navigator.clipboard.writeText(renderText(sequence));
  }, [available, sequence]);

  return { png, svg, text, csv, copySequence, available };
}
