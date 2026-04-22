import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { cacheBlob, clearCachedBlobs, getCachedBlob } from "./blob-cache";
import type { DecodedImage, ImageMetadata, ImageStatus } from "./types";
import { getImageWorker } from "./worker-client";

const DEFAULT_SIZE = 700;
const STORAGE_KEY = "string.image.v1";

interface ImageState {
  status: ImageStatus;
  errorMessage: string | null;
  bitmap: ImageBitmap | null;
  /** Pristine color-cropped RGBA, pre-preprocess. Used as the source for
   *  palette extraction and color-mode solves; in-memory only, does not
   *  persist across reloads. */
  colorRgba: Uint8Array | null;
  meta: ImageMetadata | null;
  ingest: (blob: Blob, opts?: { filename?: string }) => Promise<void>;
  /** Re-decode from IndexedDB after a page reload. */
  rehydrateFromCache: () => Promise<void>;
  reset: () => void;
}

export const useImageStore = create<ImageState>()(
  persist(
    (set, get) => ({
      status: "idle",
      errorMessage: null,
      bitmap: null,
      colorRgba: null,
      meta: null,

      async ingest(blob, opts) {
        const current = get();
        current.bitmap?.close();
        set({
          status: "decoding",
          errorMessage: null,
          bitmap: null,
          colorRgba: null,
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
            colorRgba: decoded.colorRgba,
            meta: decoded.meta,
          });
          // Cache the source blob by content hash so we can rehydrate after
          // a reload without asking the user to re-upload.
          void cacheBlob(decoded.meta.hash, blob);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to read image.";
          set({ status: "error", errorMessage: message });
        }
      },

      async rehydrateFromCache() {
        const state = get();
        if (state.bitmap || !state.meta) return;
        const blob = await getCachedBlob(state.meta.hash);
        if (!blob) return;
        try {
          const worker = getImageWorker();
          const decoded: DecodedImage = await worker.ingest(blob, {
            size: state.meta.size,
            filename: state.meta.filename,
          });
          set({
            status: "ready",
            bitmap: decoded.bitmap,
            colorRgba: decoded.colorRgba,
            meta: decoded.meta,
          });
        } catch {
          // Stale cache is fine; leave meta in place and let the user
          // upload again.
        }
      },

      reset() {
        const current = get();
        current.bitmap?.close();
        set({
          status: "idle",
          errorMessage: null,
          bitmap: null,
          colorRgba: null,
          meta: null,
        });
        void clearCachedBlobs();
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Bitmaps cannot cross localStorage; only the metadata survives. That's
      // enough for the /build route to read progress + the pattern id.
      partialize: (state) => ({
        status: state.status === "decoding" ? "idle" : state.status,
        meta: state.meta,
      }),
      version: 1,
    },
  ),
);
