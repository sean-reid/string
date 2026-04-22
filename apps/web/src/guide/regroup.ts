/**
 * Post-hoc color regrouping for the physical build.
 *
 * The solver optimizes interleaved — at every step it picks the chord
 * (pin + palette color) that most reduces residual, so the emitted
 * sequence jumps between colors freely. That's the right signal for
 * image reconstruction, but it's painful at the loom: a human builder
 * doesn't want to swap spools every few chords.
 *
 * Regrouping reorders chords by palette index (dark → light since the
 * palette is already sorted that way) while preserving within-color
 * emission order. Each chord is a (from, to) pair that stays intact;
 * between chords of the same color, thread continuity may break (the
 * earlier chord's `to` doesn't necessarily equal the next chord's
 * `from`), and the builder simply runs the thread to the next start —
 * standard practice for multi-color string art.
 *
 * The output keeps the flat `{ sequence, colors }` shape the rest of
 * the guide expects: `sequence[0]` is the first chord's `from`, then
 * every subsequent entry is a chord endpoint. `colors[i]` tags chord
 * `i` (the one that lands at `sequence[i]`); `colors[0]` is kept as
 * the first chord's color so callers that key off it behave sanely.
 */
export interface RegroupedSequence {
  sequence: number[];
  colors: number[];
}

export function regroupByColor(
  sequence: readonly number[],
  sequenceColors: readonly number[],
): RegroupedSequence {
  if (sequence.length < 2) {
    return {
      sequence: [...sequence],
      colors: [...sequenceColors],
    };
  }

  const chords: Array<{ from: number; to: number; color: number; order: number }> =
    [];
  for (let i = 1; i < sequence.length; i += 1) {
    const from = sequence[i - 1];
    const to = sequence[i];
    const color = sequenceColors[i] ?? 0;
    if (from === undefined || to === undefined) continue;
    chords.push({ from, to, color, order: i });
  }

  chords.sort((a, b) => {
    if (a.color !== b.color) return a.color - b.color;
    return a.order - b.order;
  });

  const firstChord = chords[0];
  if (!firstChord) {
    return {
      sequence: [...sequence],
      colors: [...sequenceColors],
    };
  }

  const outSequence: number[] = [firstChord.from];
  const outColors: number[] = [firstChord.color];
  for (const chord of chords) {
    outSequence.push(chord.to);
    outColors.push(chord.color);
  }
  return { sequence: outSequence, colors: outColors };
}
