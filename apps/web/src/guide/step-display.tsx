import type { ReactNode } from "react";
import {
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconSpeaker,
  IconSpeakerOff,
} from "./icons";
import { useProgressStore } from "./progress-store";
import { useSpeech } from "./speech";

interface Props {
  sequence: readonly number[];
  playing: boolean;
  onTogglePlay: () => void;
  announce: boolean;
  onToggleAnnounce: () => void;
}

export function StepDisplay({
  sequence,
  playing,
  onTogglePlay,
  announce,
  onToggleAnnounce,
}: Props) {
  const current = useProgressStore((s) => s.current);
  const advance = useProgressStore((s) => s.advance);
  const back = useProgressStore((s) => s.back);

  useSpeech(announce, sequence);

  const nail = sequence[current] ?? 0;
  const next = sequence[current + 1];
  const prev = current > 0 ? sequence[current - 1] : undefined;
  const progress = ((current + 1) / sequence.length) * 100;
  const atStart = current === 0;
  const atEnd = current >= sequence.length - 1;

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex flex-col gap-2 px-8 pt-3">
        <div className="flex items-baseline justify-between font-mono text-[11px] leading-none tabular-nums">
          <span className="text-muted">
            <span className="text-ink">{(current + 1).toLocaleString()}</span>
            <span className="mx-1 text-muted">/</span>
            <span className="text-muted">
              {sequence.length.toLocaleString()}
            </span>
          </span>
          <span className="text-muted">{progress.toFixed(1)}%</span>
        </div>
        <div
          aria-hidden="true"
          className="h-px w-full overflow-hidden bg-line"
        >
          <div
            className="h-full bg-ink transition-[width] duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <section className="flex flex-col items-center gap-6 px-8 pb-12 pt-8 text-center">
        <span className="text-xs tracking-wide text-muted">Current nail</span>
        <span
          aria-live="polite"
          className="font-mono text-accent tabular-nums"
          style={{
            fontSize: "clamp(96px, 12vw, 176px)",
            lineHeight: 0.9,
            letterSpacing: "-0.04em",
          }}
        >
          {String(nail).padStart(3, "0")}
        </span>
        <div className="flex items-center justify-center gap-10 font-mono text-xs leading-none tabular-nums">
          <span className="flex items-baseline gap-3">
            <span className="text-muted">from</span>
            <span className="text-[15px] text-ink">
              {prev !== undefined ? String(prev).padStart(3, "0") : "start"}
            </span>
          </span>
          <span aria-hidden="true" className="h-5 w-px bg-line" />
          <span className="flex items-baseline gap-3">
            <span className="text-muted">next</span>
            <span className="text-[15px] text-ink">
              {next !== undefined ? String(next).padStart(3, "0") : "end"}
            </span>
          </span>
        </div>
      </section>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-6 py-5">
        <button
          type="button"
          onClick={onToggleAnnounce}
          aria-pressed={announce}
          className={[
            "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs leading-none transition",
            announce
              ? "bg-accent-soft text-accent"
              : "text-muted hover:bg-line/40 hover:text-ink",
          ].join(" ")}
        >
          {announce ? (
            <IconSpeaker size={13} />
          ) : (
            <IconSpeakerOff size={13} />
          )}
          <span>{announce ? "Reading" : "Read aloud"}</span>
          {announce ? (
            <span
              aria-hidden="true"
              className="h-1 w-1 animate-pulse rounded-full bg-accent"
            />
          ) : null}
        </button>

        <div className="flex items-center gap-1">
          <IconButton onClick={back} disabled={atStart} label="Previous nail">
            <IconPrev size={15} />
          </IconButton>
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? "Pause auto-advance" : "Start auto-advance"}
            aria-pressed={playing}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-ink text-paper transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {playing ? <IconPause size={15} /> : <IconPlay size={15} />}
          </button>
          <IconButton onClick={advance} disabled={atEnd} label="Next nail">
            <IconNext size={15} />
          </IconButton>
        </div>
      </footer>
    </div>
  );
}

function IconButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-md text-ink/70 transition hover:bg-line/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-ink/70"
    >
      {children}
    </button>
  );
}
