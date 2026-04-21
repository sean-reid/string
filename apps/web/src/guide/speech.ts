import { useEffect, useRef } from "react";
import { useProgressStore } from "./progress-store";

/**
 * Announces the current nail whenever it changes, while enabled. Cancels
 * any pending utterance on step change so rapid advancement stays
 * responsive instead of queuing.
 */
export function useSpeech(enabled: boolean, sequence: readonly number[]) {
  const current = useProgressStore((s) => s.current);
  const lastSpoken = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof speechSynthesis === "undefined") return;
    const nail = sequence[current];
    if (nail === undefined) return;
    if (lastSpoken.current === current) return;
    lastSpoken.current = current;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(nail));
    utterance.rate = 0.95;
    speechSynthesis.speak(utterance);
  }, [enabled, current, sequence]);

  useEffect(() => {
    return () => {
      if (typeof speechSynthesis !== "undefined") {
        speechSynthesis.cancel();
      }
    };
  }, []);
}
