import { create } from "zustand";
import type { DecodedImage, ImageMetadata, ImageStatus } from "./types";
import { getImageWorker } from "./worker-client";

const DEFAULT_SIZE = 700;

interface ImageState {
  status: ImageStatus;
  errorMessage: string | null;
  bitmap: ImageBitmap | null;
  meta: ImageMetadata | null;
  ingest: (blob: Blob, opts?: { filename?: string }) => Promise<void>;
  reset: () => void;
}

export const useImageStore = create<ImageState>((set, get) => ({
  status: "idle",
  errorMessage: null,
  bitmap: null,
  meta: null,

  async ingest(blob, opts) {
    const current = get();
    current.bitmap?.close();
    set({
      status: "decoding",
      errorMessage: null,
      bitmap: null,
      meta: null,
    });
    try {
      const worker = getImageWorker();
      const decoded: DecodedImage = await worker.ingest(blob, {
        size: DEFAULT_SIZE,
        filename: opts?.filename,
      });
      set({
        status: "ready",
        bitmap: decoded.bitmap,
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
    current.bitmap?.close();
    set({
      status: "idle",
      errorMessage: null,
      bitmap: null,
      meta: null,
    });
  },
}));
