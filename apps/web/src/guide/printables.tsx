import { useState } from "react";
import { BOARDS, THREADS } from "@/solver/physics";
import { useSolverStore } from "@/solver/store";
import { downloadBlob, safeFilename } from "@/export/download";
import { buildBookletPdf } from "./pdf-booklet";
import { buildTemplatePdf } from "./pdf-template";

export function Printables() {
  const physical = useSolverStore((s) => s.physical);
  const pinPositions = useSolverStore((s) => s.pinPositions);
  const imageSize = useSolverStore((s) => s.imageSize);
  const sequence = useSolverStore((s) => s.sequence);
  const disabled = !pinPositions || imageSize <= 0 || sequence.length < 2;

  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const announce = (message: string) => {
    setStatus(message);
    window.setTimeout(
      () => setStatus((current) => (current === message ? null : current)),
      2400,
    );
  };

  const run = async (
    id: string,
    build: () => Promise<Uint8Array>,
    filenameStem: string,
    ok: string,
  ) => {
    setBusy(id);
    try {
      const bytes = await build();
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, safeFilename(filenameStem, "pdf"));
      announce(ok);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Export failed.";
      announce(message);
    } finally {
      setBusy(null);
    }
  };

  const board = BOARDS[physical.boardId];
  const thread = THREADS[physical.threadId];
  const lineCount = Math.max(0, sequence.length - 1);

  return (
    <div className="flex flex-col gap-2" aria-label="Printables">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink">Printables</span>
        <span
          aria-live="polite"
          className="font-mono text-[11px] tabular-nums text-muted"
        >
          {status ?? ""}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <PrintButton
          label="Nail template"
          hint={`${physical.pinCount} nails · 1:1`}
          disabled={disabled}
          busy={busy === "template"}
          onClick={() =>
            run(
              "template",
              () => {
                if (!pinPositions || imageSize <= 0)
                  throw new Error("no pattern");
                return buildTemplatePdf({
                  pinPositions,
                  imageSize,
                  pinCount: physical.pinCount,
                  diameterMm: board.diameterMm,
                  boardLabel: board.label,
                });
              },
              `template-${physical.boardId}-${physical.pinCount}nails`,
              "template saved",
            )
          }
        />
        <PrintButton
          label="Sequence booklet"
          hint={`${lineCount.toLocaleString()} lines`}
          disabled={disabled}
          busy={busy === "booklet"}
          onClick={() =>
            run(
              "booklet",
              () => {
                if (sequence.length < 2) throw new Error("no sequence");
                return buildBookletPdf({
                  sequence,
                  pinCount: physical.pinCount,
                  diameterMm: board.diameterMm,
                  threadLabel: thread.label,
                });
              },
              `sequence-${physical.boardId}-${lineCount}lines`,
              "booklet saved",
            )
          }
        />
      </div>
    </div>
  );
}

function PrintButton({
  label,
  hint,
  onClick,
  disabled,
  busy,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="flex w-full flex-col items-center gap-0.5 rounded-md border border-line bg-surface py-1.5 text-[11px] text-ink transition hover:border-ink hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="font-medium">{label}</span>
      <span className="font-mono text-[10px] text-muted">
        {busy ? "rendering…" : hint}
      </span>
    </button>
  );
}
