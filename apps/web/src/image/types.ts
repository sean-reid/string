export type ImageStatus = "idle" | "decoding" | "ready" | "error";

export interface ImageMetadata {
  /** Source hash (sha-256, hex) used as a cache key and share-link fragment. */
  hash: string;
  /** Original intrinsic size, before square-crop and resize. */
  sourceWidth: number;
  sourceHeight: number;
  /** EXIF rotation applied during decode (0/90/180/270). */
  rotation: 0 | 90 | 180 | 270;
  /** Resolution of the preview bitmap (square). */
  previewSize: number;
  /** Resolution of the internal solver bitmap (square). */
  solveSize: number;
  /** MIME type as reported by the File/Blob. */
  mime: string;
  /** Original filename if available. */
  filename?: string;
  /** Bytes of the source blob. */
  byteLength: number;
}

export interface DecodedImage {
  /** Displayable preview, already square-cropped and rotated. */
  preview: ImageBitmap;
  /** Lower-resolution bitmap used as solver input. */
  solve: ImageBitmap;
  meta: ImageMetadata;
}

export interface ImageWorkerApi {
  ingest(
    blob: Blob,
    opts: {
      previewSize: number;
      solveSize: number;
      filename?: string;
    },
  ): Promise<DecodedImage>;
}
