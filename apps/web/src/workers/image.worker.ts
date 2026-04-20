/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { DecodedImage, ImageMetadata, ImageWorkerApi } from "@/image/types";

const HEIC_MIMES = new Set(["image/heic", "image/heif"]);

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Reads EXIF orientation from a JPEG header. Returns the clockwise rotation
 * needed to bring the image upright, or 0 for non-JPEG / orientation 1.
 * Orientations 2/4/5/7 (mirrored) are treated as their non-mirrored peers.
 */
function jpegOrientation(view: DataView): 0 | 90 | 180 | 270 {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 0;
  let offset = 2;
  while (offset < view.byteLength - 1) {
    const marker = view.getUint16(offset);
    offset += 2;
    if (marker === 0xffe1) {
      if (view.getUint32(offset + 2) !== 0x45786966) return 0;
      const tiff = offset + 8;
      const little = view.getUint16(tiff) === 0x4949;
      const get16 = (o: number) => view.getUint16(o, little);
      const get32 = (o: number) => view.getUint32(o, little);
      if (get16(tiff + 2) !== 0x002a) return 0;
      const ifd0 = tiff + get32(tiff + 4);
      const count = get16(ifd0);
      for (let i = 0; i < count; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (get16(entry) === 0x0112) {
          const value = get16(entry + 8);
          if (value === 3 || value === 4) return 180;
          if (value === 6 || value === 5) return 90;
          if (value === 8 || value === 7) return 270;
          return 0;
        }
      }
      return 0;
    } else if ((marker & 0xff00) !== 0xff00) {
      return 0;
    } else {
      const size = view.getUint16(offset);
      offset += size;
    }
  }
  return 0;
}

function rotatedSize(
  width: number,
  height: number,
  rotation: 0 | 90 | 180 | 270,
): { w: number; h: number } {
  return rotation === 90 || rotation === 270
    ? { w: height, h: width }
    : { w: width, h: height };
}

function drawRotated(
  ctx: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  rotation: 0 | 90 | 180 | 270,
): void {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  if (rotation === 90 || rotation === 270) {
    ctx.drawImage(bitmap, -height / 2, -width / 2);
  } else {
    ctx.drawImage(bitmap, -width / 2, -height / 2);
  }
  ctx.restore();
}

function squareCrop(
  source: OffscreenCanvas,
  target: OffscreenCanvas,
): void {
  const side = Math.min(source.width, source.height);
  const sx = (source.width - side) / 2;
  const sy = (source.height - side) / 2;
  const ctx = target.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable on target canvas");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, side, side, 0, 0, target.width, target.height);
}

async function decodeBlob(blob: Blob): Promise<ImageBitmap> {
  if (HEIC_MIMES.has(blob.type)) {
    throw new Error("HEIC is not supported yet; convert to JPEG or PNG first.");
  }
  return createImageBitmap(blob);
}

const api: ImageWorkerApi = {
  async ingest(blob, opts) {
    const bytes = await blob.arrayBuffer();
    const hash = await sha256Hex(bytes);

    const rotation = blob.type === "image/jpeg"
      ? jpegOrientation(new DataView(bytes))
      : 0;

    const raw = await decodeBlob(blob);
    const { w: oriented_w, h: oriented_h } = rotatedSize(
      raw.width,
      raw.height,
      rotation,
    );

    const orientedCanvas = new OffscreenCanvas(oriented_w, oriented_h);
    const orientedCtx = orientedCanvas.getContext("2d");
    if (!orientedCtx) throw new Error("2D context unavailable");
    drawRotated(orientedCtx, raw, rotation);
    raw.close();

    const previewCanvas = new OffscreenCanvas(opts.previewSize, opts.previewSize);
    const solveCanvas = new OffscreenCanvas(opts.solveSize, opts.solveSize);
    squareCrop(orientedCanvas, previewCanvas);
    squareCrop(orientedCanvas, solveCanvas);

    const [preview, solve] = await Promise.all([
      previewCanvas.transferToImageBitmap(),
      solveCanvas.transferToImageBitmap(),
    ]);

    const meta: ImageMetadata = {
      hash,
      sourceWidth: oriented_w,
      sourceHeight: oriented_h,
      rotation,
      previewSize: opts.previewSize,
      solveSize: opts.solveSize,
      mime: blob.type || "application/octet-stream",
      filename: opts.filename,
      byteLength: blob.size,
    };

    const result: DecodedImage = { preview, solve, meta };
    return Comlink.transfer(result, [preview, solve]);
  },
};

Comlink.expose(api);
