import { useCallback } from "react";
import { useImageStore } from "./store";

interface Sample {
  src: string;
  description: string;
}

const SAMPLES: Sample[] = [
  {
    src: "/samples/face1.jpg",
    description: "Portrait on black, tight face crop",
  },
  {
    src: "/samples/face2.jpg",
    description: "Portrait on pink, freckles, direct gaze",
  },
  {
    src: "/samples/face3.jpg",
    description: "Portrait with striking pale eyes, tan wall",
  },
  {
    src: "/samples/face4.jpg",
    description: "Portrait in striped shirt, soft golden light",
  },
];

export function SampleGallery() {
  const ingest = useImageStore((s) => s.ingest);
  const status = useImageStore((s) => s.status);
  const busy = status === "decoding";

  const load = useCallback(
    async (sample: Sample, index: number) => {
      if (busy) return;
      try {
        const response = await fetch(sample.src);
        if (!response.ok) throw new Error(`Sample not found`);
        const blob = await response.blob();
        await ingest(blob, { filename: `sample-${index + 1}` });
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
        {SAMPLES.map((sample, index) => (
          <li key={sample.src}>
            <button
              type="button"
              onClick={() => void load(sample, index)}
              disabled={busy}
              aria-label={sample.description}
              className="group block w-full rounded-lg transition disabled:opacity-50"
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
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
