import { create } from "zustand";

interface ViewState {
  /** Whether to render the preprocessed source as an underlay behind the threads. */
  showSource: boolean;
  toggleSource: () => void;
  setShowSource: (value: boolean) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  showSource: true,
  toggleSource: () => set((prev) => ({ showSource: !prev.showSource })),
  setShowSource: (value) => set({ showSource: value }),
}));
