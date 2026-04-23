/**
 * Post-hoc color regrouping for the physical build.
 *
 * The solver optimizes interleaved — at every step it picks the chord
 * (pin + palette color) that most reduces residual, so the emitted
 * sequence jumps between colors freely. That's the right signal for
 * image reconstruction, but it's painful at the loom: a human builder
 * doesn't want to swap spools every few chords.
 *
 * Regrouping walks each color's chord subgraph as a near-Eulerian
 * trail via Hierholzer's algorithm. Within a color the builder can
 * thread continuously for long runs; when the subgraph has too many
 * odd-degree vertices or multiple components, the walk breaks and a
 * "break chord" (color sentinel `BREAK_COLOR`) is emitted so
 * renderers can skip the visual connector while keeping the flat
 * sequence format. Between colors there's always a break (the
 * builder cuts and swaps spools).
 *
 * Output shape matches the input: consecutive entries in `sequence`
 * are chord endpoints, and `colors[i]` tags the chord ending at
 * `sequence[i]`. `colors[i] === BREAK_COLOR` means sequence[i-1] →
 * sequence[i] is a thread-cut jump rather than a real chord, and
 * the chord should not be drawn.
 */

/** Sentinel in the `colors` array marking a "break" (thread cut). */
export const BREAK_COLOR = -1;

export interface RegroupedSequence {
  sequence: number[];
  colors: number[];
}

interface Chord {
  from: number;
  to: number;
  color: number;
  order: number;
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

  const chords: Chord[] = [];
  for (let i = 1; i < sequence.length; i += 1) {
    const from = sequence[i - 1];
    const to = sequence[i];
    const color = sequenceColors[i] ?? 0;
    if (from === undefined || to === undefined) continue;
    if (from === to) continue;
    chords.push({ from, to, color, order: i });
  }
  if (chords.length === 0) {
    return { sequence: [...sequence], colors: [...sequenceColors] };
  }

  // Group chords by color, preserving original emission order as a
  // tiebreaker for starting-vertex choice.
  const byColor = new Map<number, Chord[]>();
  for (const c of chords) {
    let bucket = byColor.get(c.color);
    if (!bucket) {
      bucket = [];
      byColor.set(c.color, bucket);
    }
    bucket.push(c);
  }
  const colorOrder = [...byColor.keys()].sort((a, b) => a - b);

  const outSequence: number[] = [];
  const outColors: number[] = [];

  for (let idx = 0; idx < colorOrder.length; idx += 1) {
    const color = colorOrder[idx];
    if (color === undefined) continue;
    const colorChords = byColor.get(color);
    if (!colorChords || colorChords.length === 0) continue;

    const walks = eulerianWalks(colorChords);
    for (const walk of walks) {
      if (walk.length === 0) continue;
      const first = walk[0];
      if (first === undefined) continue;
      if (outSequence.length === 0) {
        outSequence.push(first);
        outColors.push(color);
      } else {
        // Bridge from the previous walk's last pin to this walk's
        // start. If they happen to coincide, skip the break.
        const last = outSequence[outSequence.length - 1];
        if (last !== first) {
          outSequence.push(first);
          outColors.push(BREAK_COLOR);
        }
      }
      for (let i = 1; i < walk.length; i += 1) {
        const pin = walk[i];
        if (pin === undefined) continue;
        outSequence.push(pin);
        outColors.push(color);
      }
    }
  }

  return { sequence: outSequence, colors: outColors };
}

/**
 * Produce one or more Eulerian walks over the given chord set.
 * Each walk is a list of pin indices where consecutive pairs are
 * real edges from the input. Multiple walks are returned when the
 * underlying multigraph isn't a single Eulerian trail (too many
 * odd-degree vertices, disconnected components).
 */
function eulerianWalks(chords: Chord[]): number[][] {
  // Augment the subgraph with T-join bridging edges so each connected
  // component has ≤ 2 odd-degree vertices — Hierholzer can then cover
  // a whole component in one trail. Synthetic edges cost a few extra
  // chords per color but give the builder a single continuous walk
  // per spool instead of breaking at every parity mismatch.
  const augmented = tJoinAugment(chords);

  // Build an adjacency list keyed by pin index. Each entry stores
  // `(neighbor, chordIndex)` so we can mark edges as used.
  const adj = new Map<number, Array<{ to: number; edge: number }>>();
  const used = new Uint8Array(augmented.length);

  const push = (pin: number, entry: { to: number; edge: number }) => {
    let list = adj.get(pin);
    if (!list) {
      list = [];
      adj.set(pin, list);
    }
    list.push(entry);
  };

  for (let i = 0; i < augmented.length; i += 1) {
    const c = augmented[i];
    if (!c) continue;
    push(c.from, { to: c.to, edge: i });
    push(c.to, { to: c.from, edge: i });
  }

  const walks: number[][] = [];
  const totalEdges = augmented.length;
  let usedCount = 0;

  while (usedCount < totalEdges) {
    // Pick a start vertex. Prefer an odd-unused-degree vertex (so
    // Hierholzer's produces an open trail ending at another odd
    // vertex). If none, fall back to any vertex with unused edges.
    const start = pickStart(adj, used, augmented);
    if (start === null) break;
    const walk = hierholzer(adj, used, start);
    if (walk.length > 0) {
      walks.push(walk);
      usedCount += walk.length - 1;
    } else {
      break;
    }
  }

  // Within a color, prefer the longest walk first so it anchors the
  // builder's continuous run and shorter walks become the follow-ups.
  walks.sort((a, b) => b.length - a.length);
  return walks;
}

/**
 * T-join approximation. For each connected component of the chord
 * subgraph, pair up odd-degree vertices by pin-index proximity and
 * emit a synthetic bridging chord per pair (leaving one pair of odds
 * so Hierholzer can open-trail between them). The returned chord list
 * is the input augmented with these bridges; component parity is now
 * ≤ 2 odd vertices, so a single Eulerian trail covers each component.
 *
 * Pairing by sorted pin index is a cheap approximation to the true
 * minimum-weight matching (Edmonds' blossom is overkill for the 10–40
 * odd vertices a color subgraph typically has). Bridges inherit the
 * color of the component and are tagged with `order = MAX_SAFE_INTEGER`
 * so they sort last — real chords still dominate the starting-vertex
 * tiebreak in `pickStart`.
 */
function tJoinAugment(chords: Chord[]): Chord[] {
  if (chords.length === 0) return chords;

  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = parent.get(x);
    if (r === undefined) {
      parent.set(x, x);
      return x;
    }
    while (r !== x) {
      const next = parent.get(r);
      if (next === undefined || next === r) break;
      parent.set(x, next);
      x = r;
      r = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const degree = new Map<number, number>();
  for (const c of chords) {
    degree.set(c.from, (degree.get(c.from) ?? 0) + 1);
    degree.set(c.to, (degree.get(c.to) ?? 0) + 1);
    union(c.from, c.to);
  }

  const oddByComponent = new Map<number, number[]>();
  for (const [pin, d] of degree) {
    if (d % 2 !== 1) continue;
    const root = find(pin);
    let bucket = oddByComponent.get(root);
    if (!bucket) {
      bucket = [];
      oddByComponent.set(root, bucket);
    }
    bucket.push(pin);
  }

  const color = chords[0]?.color ?? 0;
  const synthetic: Chord[] = [];
  for (const odds of oddByComponent.values()) {
    odds.sort((a, b) => a - b);
    for (let i = 0; i + 2 < odds.length; i += 2) {
      const u = odds[i];
      const v = odds[i + 1];
      if (u === undefined || v === undefined || u === v) continue;
      synthetic.push({
        from: u,
        to: v,
        color,
        order: Number.MAX_SAFE_INTEGER,
      });
    }
  }

  return synthetic.length === 0 ? chords : chords.concat(synthetic);
}

function pickStart(
  adj: Map<number, Array<{ to: number; edge: number }>>,
  used: Uint8Array,
  chords: Chord[],
): number | null {
  let fallback: number | null = null;
  let fallbackOrder = Number.POSITIVE_INFINITY;
  let oddPick: number | null = null;
  let oddOrder = Number.POSITIVE_INFINITY;
  for (const [pin, list] of adj) {
    let degree = 0;
    let earliest = Number.POSITIVE_INFINITY;
    for (const entry of list) {
      if (!used[entry.edge]) {
        degree += 1;
        const chord = chords[entry.edge];
        if (chord && chord.order < earliest) {
          earliest = chord.order;
        }
      }
    }
    if (degree === 0) continue;
    if (fallback === null || earliest < fallbackOrder) {
      fallback = pin;
      fallbackOrder = earliest;
    }
    if (degree % 2 === 1 && (oddPick === null || earliest < oddOrder)) {
      oddPick = pin;
      oddOrder = earliest;
    }
  }
  return oddPick ?? fallback;
}

function hierholzer(
  adj: Map<number, Array<{ to: number; edge: number }>>,
  used: Uint8Array,
  start: number,
): number[] {
  // Track a per-vertex cursor into its adjacency list so we never
  // rescan already-skipped entries. Necessary for O(E) behavior on
  // dense graphs.
  const cursor = new Map<number, number>();
  for (const pin of adj.keys()) cursor.set(pin, 0);

  const stack: number[] = [start];
  const walk: number[] = [];
  while (stack.length > 0) {
    const v = stack[stack.length - 1];
    if (v === undefined) break;
    const list = adj.get(v);
    let found: { to: number; edge: number } | null = null;
    if (list) {
      let c = cursor.get(v) ?? 0;
      while (c < list.length) {
        const entry = list[c];
        c += 1;
        if (entry && !used[entry.edge]) {
          used[entry.edge] = 1;
          found = entry;
          cursor.set(v, c);
          break;
        }
      }
      if (!found) cursor.set(v, list.length);
    }
    if (found) {
      stack.push(found.to);
    } else {
      const popped = stack.pop();
      if (popped !== undefined) walk.push(popped);
    }
  }
  walk.reverse();
  return walk;
}
