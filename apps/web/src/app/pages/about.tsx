import { Link } from "react-router";

export function AboutPage() {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">About</h1>
        <p className="mt-2 text-muted">
          Turning a photograph into string art, then into step-by-step
          instructions for building it on a wood round.
        </p>
      </header>

      <section className="flex flex-col gap-3 text-sm leading-relaxed text-ink">
        <p>
          String art is a craft where thread is wrapped around nails driven
          into a circular board, in a specific order, so the overlapping
          chords form an image. Lit regions of the target photo end up with
          many thread passes; dark regions get few, and the wood shows
          through.
        </p>
        <p>
          The solver picks one chord at a time. It scores every candidate pin
          by the line integral of brightness still needed along the chord,
          samples one via softmax with an annealed temperature, then subtracts
          the chord's thread coverage from the residual. A ban queue on the
          last few pins prevents repetitive spokes. Parameters match the
          physical piece you would build: board diameter in inches, thread
          width in millimetres, minimum chord length as a percent of the
          diameter.
        </p>
        <p>
          Everything runs in your browser. The solver is a Rust crate
          compiled to WebAssembly, the rasteriser uses Xiaolin-Wu antialiased
          lines, and no image leaves your machine.
        </p>
      </section>

      <section className="flex flex-col gap-2 text-sm text-muted">
        <h2 className="font-display text-lg text-ink">Further reading</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <a
              href="http://artof01.com/vrellis/works/knit.html"
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink"
            >
              Petros Vrellis, the original algorithmic string portrait
            </a>
          </li>
          <li>
            <a
              href="https://archive.bridgesmathart.org/2022/bridges2022-63.pdf"
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink"
            >
              Demoussel &amp; Larboulette, Bridges 2022
            </a>
          </li>
          <li>
            <a
              href="https://www.cg.tuwien.ac.at/research/publications/2018/Birsak2018-SA/"
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink"
            >
              Birsak et al., computational fabrication of string images
            </a>
          </li>
        </ul>
      </section>

      <Link to="/" className="text-accent hover:underline">
        Back to the loom
      </Link>
    </section>
  );
}
