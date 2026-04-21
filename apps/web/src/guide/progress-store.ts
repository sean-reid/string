import { create } from "zustand";

interface ProgressState {
  /** Step index the builder is currently on. */
  current: number;
  /** Per-step completion flags, indexed by step number. */
  checked: boolean[];
  patternId: string | null;
  load: (patternId: string, sequenceLength: number) => void;
  setCurrent: (step: number) => void;
  advance: () => void;
  back: () => void;
  toggle: (step: number) => void;
  reset: () => void;
}

function storageKey(id: string): string {
  return `string.build.progress.${id}`;
}

function readPersisted(
  id: string,
  length: number,
): { current: number; checked: boolean[] } | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      current?: number;
      checked?: boolean[];
    };
    const checked = new Array(length).fill(false);
    (parsed.checked ?? []).forEach((v, i) => {
      if (i < length) checked[i] = Boolean(v);
    });
    return {
      current: Math.min(Math.max(parsed.current ?? 0, 0), Math.max(0, length - 1)),
      checked,
    };
  } catch {
    return null;
  }
}

function persist(id: string, current: number, checked: boolean[]): void {
  try {
    localStorage.setItem(
      storageKey(id),
      JSON.stringify({ current, checked }),
    );
  } catch {
    // localStorage full or disabled; progress is not persisted.
  }
}

export const useProgressStore = create<ProgressState>((set, get) => ({
  current: 0,
  checked: [],
  patternId: null,

  load(patternId, sequenceLength) {
    if (get().patternId === patternId && get().checked.length === sequenceLength) {
      return;
    }
    const persisted = readPersisted(patternId, sequenceLength);
    set({
      patternId,
      current: persisted?.current ?? 0,
      checked: persisted?.checked ?? new Array(sequenceLength).fill(false),
    });
  },

  setCurrent(step) {
    const state = get();
    if (!state.patternId) return;
    const clamped = Math.min(Math.max(step, 0), Math.max(0, state.checked.length - 1));
    set({ current: clamped });
    persist(state.patternId, clamped, state.checked);
  },

  advance() {
    const state = get();
    if (!state.patternId) return;
    const next = Math.min(state.current + 1, Math.max(0, state.checked.length - 1));
    const nextChecked = state.checked.slice();
    nextChecked[state.current] = true;
    set({ current: next, checked: nextChecked });
    persist(state.patternId, next, nextChecked);
  },

  back() {
    const state = get();
    if (!state.patternId) return;
    const prev = Math.max(state.current - 1, 0);
    set({ current: prev });
    persist(state.patternId, prev, state.checked);
  },

  toggle(step) {
    const state = get();
    if (!state.patternId) return;
    if (step < 0 || step >= state.checked.length) return;
    const nextChecked = state.checked.slice();
    nextChecked[step] = !nextChecked[step];
    set({ checked: nextChecked });
    persist(state.patternId, state.current, nextChecked);
  },

  reset() {
    const state = get();
    if (!state.patternId) return;
    const nextChecked = new Array(state.checked.length).fill(false);
    set({ current: 0, checked: nextChecked });
    persist(state.patternId, 0, nextChecked);
  },
}));
