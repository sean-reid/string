/** Trigger a browser download for a blob using an in-memory anchor. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the download actually starts.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function safeFilename(stem: string, extension: string): string {
  const cleaned = stem
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "string-art";
  return `${cleaned}.${extension}`;
}
