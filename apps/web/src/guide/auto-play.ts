import { useEffect, useRef, useState } from "react";
import { useProgressStore } from "./progress-store";

const DEFAULT_BPM = 15;

export function useAutoPlay() {
  const advance = useProgressStore((s) => s.advance);
  // Research is clear: default paused. The user sets the pace with their hands.
  const [playing, setPlaying] = useState(false);
  const [bpm] = useState(DEFAULT_BPM);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!playing) return;
    const intervalMs = Math.round(60_000 / bpm);
    const id = window.setInterval(() => {
      tick(audioCtxRef);
      advance();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [playing, bpm, advance]);

  return {
    playing,
    toggle: () => setPlaying((p) => !p),
    stop: () => setPlaying(false),
  };
}

function tick(ref: { current: AudioContext | null }) {
  try {
    if (!ref.current) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ref.current = new AC();
    }
    const ctx = ref.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 780;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.11);
  } catch {
    // Silent fail; audio is nice-to-have.
  }
}
