export type ImageStatus = "idle" | "decoding" | "ready" | "error";

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageMetadata {
  /** Source hash (sha-256, hex) used as a cache key and share-link fragment. */
  hash: string;
  /** Original intrinsic size, before square-crop and resize. */
  sourceWidth: number;
  sourceHeight: number;
  /** EXIF rotation applied during decode (0/90/180/270). */
  rotation: 0 | 90 | 180 | 270;
  /** Edge length of the square preprocessed bitmap, in pixels. */
  size: number;
  /** MIME type as reported by the File/Blob. */
  mime: string;
  /** Original filename if available. */
  filename?: string;
  /** Bytes of the source blob. */
  byteLength: number;
  /** Detected face region in solver-image coordinates (may be an estimate). */
  faceBox?: FaceBox;
  /** True when the face region was detected by a real model, false if estimated. */
  faceDetected: boolean;
}

export interface DecodedImage {
  /** Preprocessed square bitmap, ready to render in the compose preview. */
  bitmap: ImageBitmap;
  /** Raw square-cropped RGBA (pre-preprocess, original colors). Used by
   *  palette extraction and color-mode solves; mono solves still pipe the
   *  grayscale bitmap into the solver. Length is `size * size * 4`. */
  colorRgba: Uint8Array;
  meta: ImageMetadata;
}

export interface IngestOptions {
  size: number;
  filename?: string;
}

export interface ImageWorkerApi {
  ingest(blob: Blob, opts: IngestOptions): Promise<DecodedImage>;
}
