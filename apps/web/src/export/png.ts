interface PngExportInput {
  bitmap: ImageBitmap | null;
  showSource: boolean;
  sequence: readonly number[];
  pinPositions: Float32Array | null;
  imageSize: number;
  threadColor: string;
  lineOpacity: number;
  lineWidth: number;
  outputSize: number;
}

const STROKE_BATCH = 16;

/**
 * Render the loom at an arbitrary output resolution by replaying the
 * underlay and the thread sequence onto a fresh OffscreenCanvas, then
 * returning the encoded PNG blob.
 */
export async function renderPng(input: PngExportInput): Promise<Blob> {
  const { outputSize, imageSize } = input;
  if (imageSize <= 0) throw new Error("No image to export.");

  const canvas = new OffscreenCanvas(outputSize, outputSize);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context not available.");

  ctx.save();
  const radius = outputSize / 2 - 1;
  ctx.beginPath();
  ctx.arc(outputSize / 2, outputSize / 2, radius, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = "#0E0D0B";
  ctx.fillRect(0, 0, outputSize, outputSize);

  if (input.showSource && input.bitmap) {
    ctx.globalAlpha = 0.2;
    ctx.drawImage(input.bitmap, 0, 0, outputSize, outputSize);
    ctx.globalAlpha = 1;
  }

  if (input.pinPositions && input.sequence.length >= 2) {
    ctx.strokeStyle = input.threadColor;
    ctx.globalAlpha = input.lineOpacity;
    ctx.lineWidth = (input.lineWidth * outputSize) / imageSize;
    ctx.lineCap = "round";

    const scale = outputSize / imageSize;
    let batchSize = 0;
    ctx.beginPath();
    for (let i = 1; i < input.sequence.length; i++) {
      const from = input.sequence[i - 1];
      const to = input.sequence[i];
      if (from === undefined || to === undefined) continue;
      const fx = input.pinPositions[from * 2];
      const fy = input.pinPositions[from * 2 + 1];
      const tx = input.pinPositions[to * 2];
      const ty = input.pinPositions[to * 2 + 1];
      if (
        fx === undefined ||
        fy === undefined ||
        tx === undefined ||
        ty === undefined
      )
        continue;
      ctx.moveTo(fx * scale, fy * scale);
      ctx.lineTo(tx * scale, ty * scale);
      batchSize++;
      if (batchSize >= STROKE_BATCH) {
        ctx.stroke();
        ctx.beginPath();
        batchSize = 0;
      }
    }
    if (batchSize > 0) ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "#141311";
  ctx.lineWidth = Math.max(1, outputSize / 1024);
  ctx.beginPath();
  ctx.arc(outputSize / 2, outputSize / 2, radius, 0, Math.PI * 2);
  ctx.stroke();

  return canvas.convertToBlob({ type: "image/png" });
}
