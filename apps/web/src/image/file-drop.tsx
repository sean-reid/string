import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useImageStore } from "./store";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";
const MAX_BYTES = 40 * 1024 * 1024; // 40 MB

export function FileDrop() {
  const ingest = useImageStore((s) => s.ingest);
  const status = useImageStore((s) => s.status);
  const errorMessage = useImageStore((s) => s.errorMessage);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = useCallback(
    (blob: Blob, filename?: string) => {
      if (!blob.type.startsWith("image/")) {
        useImageStore.setState({
          status: "error",
          errorMessage: "That file type is not an image.",
        });
        return;
      }
      if (blob.size > MAX_BYTES) {
        useImageStore.setState({
          status: "error",
          errorMessage: "Image is larger than 40 MB. Resize and try again.",
        });
        return;
      }
      void ingest(blob, { filename });
    },
    [ingest],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) accept(file, file.name);
    },
    [accept],
  );

  const onPick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) accept(file, file.name);
      event.target.value = "";
    },
    [accept],
  );

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            accept(file, file.name || "clipboard");
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [accept]);

  const busy = status === "decoding";

  return (
    <label
      htmlFor={inputId}
      data-dragging={dragging || undefined}
      data-status={status}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
      className={[
        "flex w-full max-w-[520px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-8 py-10 text-center transition",
        "border-line hover:border-accent/60 focus-within:border-accent",
        "data-[dragging]:border-accent data-[dragging]:bg-accent-soft/40",
        busy ? "pointer-events-none opacity-80" : "",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT}
        onChange={onPick}
        className="sr-only"
        aria-label="Choose an image to turn into string art"
        disabled={busy}
      />
      <p className="font-display text-2xl tracking-tight text-ink">
        {busy ? "Reading image" : "Drop an image"}
      </p>
      <p className="text-sm text-muted">
        {busy
          ? "One moment."
          : "or paste with \u2318V, or click to pick a file"}
      </p>
      {status === "error" && errorMessage ? (
        <p role="alert" className="text-sm text-accent">
          {errorMessage}
        </p>
      ) : null}
    </label>
  );
}
