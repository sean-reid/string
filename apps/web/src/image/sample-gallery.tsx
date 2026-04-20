import { useCallback } from "react";
import { useImageStore } from "./store";

interface Sample {
  src: string;
  label: string;
  description: string;
}

const SAMPLES: Sample[] = [
  {
    src: "/samples/face.jpg",
    label: "Face",
    description: "Human headshot in soft window light",
  },
  {
    src: "/samples/portrait.jpg",
    label: "Portrait",
    description: "Lioness at close range, strong eye contact",
  },
  {
    src: "/samples/landscape.jpg",
    label: "Landscape",
    description: "Highland ridge with a thread of road",
  },
  {
    src: "/samples/flower.jpg",
    label: "Botanical",
    description: "Purple petunias in low light",
  },
];

export function SampleGallery() {
  const ingest = useImageStore((s) => s.ingest);
  const status = useImageStore((s) => s.status);
  const busy = status === "decoding";

  const load = useCallback(
    async (sample: Sample) => {
      if (busy) return;
      try {
        const response = await fetch(sample.src);
        if (!response.ok) throw new Error(`Sample not found: ${sample.label}`);
        const blob = await response.blob();
        await ingest(blob, { filename: sample.label });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not load sample.";
        useImageStore.setState({ status: "error", errorMessage: message });
      }
    },
    [ingest, busy],
  );

  return (
    <section aria-label="Sample images" className="flex w-full max-w-[520px] flex-col items-center gap-3">
      <p className="text-sm text-muted">or try a sample</p>
      <ul className="grid w-full grid-cols-4 gap-3">
        {SAMPLES.map((sample) => (
          <li key={sample.src}>
            <button
              type="button"
              onClick={() => void load(sample)}
              disabled={busy}
              aria-label={`Use sample: ${sample.label}. ${sample.description}.`}
              className="group flex w-full flex-col items-center gap-1.5 rounded-lg transition disabled:opacity-50"
            >
              <span className="block aspect-square w-full overflow-hidden rounded-md border border-line ring-0 ring-accent/70 transition group-hover:ring-2 group-focus-visible:ring-2">
                <img
                  src={sample.src}
                  alt=""
                  loading="lazy"
                  width={160}
                  height={160}
                  className="h-full w-full object-cover"
                />
              </span>
              <span className="text-xs text-muted group-hover:text-ink">
                {sample.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
