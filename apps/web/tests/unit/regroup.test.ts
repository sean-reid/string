import { describe, expect, test } from "vitest";
import { BREAK_COLOR, regroupByColor } from "@/guide/regroup";

function chordsOf(seq: { sequence: number[]; colors: number[] }) {
  const out: Array<{ from: number; to: number; color: number }> = [];
  for (let i = 1; i < seq.sequence.length; i += 1) {
    const from = seq.sequence[i - 1];
    const to = seq.sequence[i];
    if (from === undefined || to === undefined) continue;
    out.push({ from, to, color: seq.colors[i] ?? 0 });
  }
  return out;
}

describe("regroupByColor", () => {
  test("preserves every real chord with its original color tag", () => {
    // Four-chord interleaved sequence: colors jump around.
    const sequence = [0, 5, 12, 3, 8];
    const colors = [0, 0, 1, 0, 1];
    const regrouped = regroupByColor(sequence, colors);
    const realChords = chordsOf(regrouped).filter((c) => c.color >= 0);
    // Every original chord must appear in the regrouped output,
    // with the same color tag. Order may differ.
    const expected = [
      { from: 0, to: 5, color: 0 },
      { from: 5, to: 12, color: 1 },
      { from: 12, to: 3, color: 0 },
      { from: 3, to: 8, color: 1 },
    ];
    for (const chord of expected) {
      const key = (c: { from: number; to: number; color: number }) =>
        (c.from === chord.from && c.to === chord.to) ||
        (c.from === chord.to && c.to === chord.from);
      expect(
        realChords.some((c) => key(c) && c.color === chord.color),
      ).toBe(true);
    }
  });

  test("mono input passes through without break markers", () => {
    const sequence = [0, 5, 12, 3, 8];
    const colors = [0, 0, 0, 0, 0];
    const regrouped = regroupByColor(sequence, colors);
    expect(regrouped.colors.every((c) => c >= 0)).toBe(true);
    // All 4 chords preserved.
    expect(regrouped.sequence.length).toBe(sequence.length);
  });

  test("break markers appear between discontinuous color runs", () => {
    // Two color 0 chords that don't share an endpoint, and one
    // color 1 chord. Regroup must insert at least one BREAK_COLOR
    // connector to bridge between disconnected walks.
    const sequence = [0, 5, 10, 20, 30];
    const colors = [0, 0, 1, 0, 0];
    const regrouped = regroupByColor(sequence, colors);
    expect(regrouped.colors.some((c) => c === BREAK_COLOR)).toBe(true);
  });

  test("short sequence passes through unchanged", () => {
    const regrouped = regroupByColor([7], [0]);
    expect(regrouped.sequence).toEqual([7]);
    expect(regrouped.colors).toEqual([0]);
  });

  test("empty sequence returns empty output", () => {
    const regrouped = regroupByColor([], []);
    expect(regrouped.sequence).toEqual([]);
    expect(regrouped.colors).toEqual([]);
  });

  test("t-join bridges four-odd-vertex subgraph into a single walk", () => {
    // Two disjoint chord pairs (4 odd vertices, 1 connected component
    // via chain): 0-5, 5-10, 10-20, 20-30. Vertices 0 and 30 have
    // degree 1 (odd); vertices 5, 10, 20 have degree 2 (even). That's
    // only 2 odd, so already Eulerian — bump it to 4 odd by adding
    // a pendant pair: 10-40, 10-50 adds degree 2 to pin 10 (still
    // even) and degree 1 each to pins 40 and 50 (two new odd).
    // Pre-T-join: 4 odd vertices forces 2 walks.
    // Post-T-join: bridge pairs {0,30} and {40,50} (or similar), so
    // Hierholzer finds a single continuous trail with one synthetic
    // bridge chord. All real chords must remain drawn; the synthetic
    // bridge is an extra same-color chord.
    const sequence = [0, 5, 10, 20, 30, 10, 40, 10, 50];
    const colors = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const regrouped = regroupByColor(sequence, colors);
    // No breaks — T-join keeps the trail continuous.
    expect(regrouped.colors.every((c) => c >= 0)).toBe(true);
    // Every original chord is present (order may differ).
    const realChordsOut = chordsOf(regrouped);
    const originals = [
      [0, 5],
      [5, 10],
      [10, 20],
      [20, 30],
      [30, 10],
      [10, 40],
      [40, 10],
      [10, 50],
    ] as const;
    for (const [a, b] of originals) {
      expect(
        realChordsOut.some(
          (c) => (c.from === a && c.to === b) || (c.from === b && c.to === a),
        ),
      ).toBe(true);
    }
    // Post-T-join, the sequence is at least original length (may have
    // one extra chord for the synthetic bridge).
    expect(regrouped.sequence.length).toBeGreaterThanOrEqual(sequence.length);
  });

  test("eulerian triangle collapses to one continuous walk", () => {
    // Three chords forming a triangle A-B, B-C, C-A (all same color).
    // Every vertex has even degree; Hierholzer produces one closed
    // walk touching each edge exactly once — no breaks.
    const sequence = [0, 1, 2, 0];
    const colors = [0, 0, 0, 0];
    const regrouped = regroupByColor(sequence, colors);
    expect(regrouped.colors.every((c) => c >= 0)).toBe(true);
    expect(regrouped.sequence.length).toBe(sequence.length);
  });
});
