import { useState } from "react";
import { useExports } from "./use-exports";

export function ExportPanel() {
  const exp = useExports();
  const [status, setStatus] = useState<string | null>(null);

  const announce = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus((current) => (current === message ? null : current)), 2400);
  };

  const run = async (action: () => Promise<void>, ok: string) => {
    try {
      await action();
      announce(ok);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Export failed.";
      announce(message);
    }
  };

  return (
    <div className="flex flex-col gap-2" aria-label="Export">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink">Export</span>
        <span
          aria-live="polite"
          className="font-mono text-[11px] tabular-nums text-muted"
        >
          {status ?? ""}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <ExportButton
          label="PNG 1x"
          hint="1024 px"
          onClick={() => run(() => exp.png(1), "PNG 1x saved")}
          disabled={!exp.available}
        />
        <ExportButton
          label="PNG 2x"
          hint="2048 px"
          onClick={() => run(() => exp.png(2), "PNG 2x saved")}
          disabled={!exp.available}
        />
        <ExportButton
          label="PNG 4x"
          hint="4096 px"
          onClick={() => run(() => exp.png(4), "PNG 4x saved")}
          disabled={!exp.available}
        />
        <ExportButton
          label="SVG"
          hint="vector"
          onClick={() => run(exp.svg, "SVG saved")}
          disabled={!exp.available}
        />
        <ExportButton
          label="CSV"
          hint="sequence"
          onClick={() => run(exp.csv, "CSV saved")}
          disabled={!exp.available}
        />
        <ExportButton
          label="Copy"
          hint="nail list"
          onClick={() => run(exp.copySequence, "copied to clipboard")}
          disabled={!exp.available}
        />
      </div>
    </div>
  );
}

function ExportButton({
  label,
  hint,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-0.5 rounded-md border border-line bg-surface py-1.5 text-[11px] text-ink transition hover:border-ink hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="font-medium">{label}</span>
      <span className="font-mono text-[10px] text-muted">{hint}</span>
    </button>
  );
}
