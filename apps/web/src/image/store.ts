import { create } from "zustand";
import type { DecodedImage, ImageMetadata, ImageStatus } from "./types";
import { getImageWorker } from "./worker-client";

const DEFAULT_PREVIEW_SIZE = 1024;
const DEFAULT_SOLVE_SIZE = 700;

interface ImageState {
  status: ImageStatus;
  errorMessage: string | null;
  preview: ImageBitmap | null;
  solve: ImageBitmap | null;
  meta: ImageMetadata | null;
  ingest: (blob: Blob, opts?: { filename?: string }) => Promise<void>;
  reset: () => void;
}

export const useImageStore = create<ImageState>((set, get) => ({
  status: "idle",
  errorMessage: null,
  preview: null,
  solve: null,
  meta: null,

  async ingest(blob, opts) {
    const current = get();
    current.preview?.close();
    current.solve?.close();
    set({
      status: "decoding",
      errorMessage: null,
      preview: null,
      solve: null,
      meta: null,
    });
    try {
      const worker = getImageWorker();
      const decoded: DecodedImage = await worker.ingest(blob, {
        previewSize: DEFAULT_PREVIEW_SIZE,
        solveSize: DEFAULT_SOLVE_SIZE,
        filename: opts?.filename,
      });
      set({
        status: "ready",
        preview: decoded.preview,
        solve: decoded.solve,
        meta: decoded.meta,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to read image.";
      set({ status: "error", errorMessage: message });
    }
  },

  reset() {
    const current = get();
    current.preview?.close();
    current.solve?.close();
    set({
      status: "idle",
      errorMessage: null,
      preview: null,
      solve: null,
      meta: null,
    });
  },
}));
