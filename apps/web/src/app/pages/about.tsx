import { Link } from "react-router";

export function AboutPage() {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">About</h1>
        <p className="mt-2 text-muted">
          Continuous-string portraits, and what this site does with them.
        </p>
      </header>

      <section className="flex flex-col gap-4 text-sm leading-relaxed text-ink">
        <h2 className="font-display text-lg">Petros Vrellis</h2>
        <p>
          In 2016{" "}
          <a
            href="http://artof01.com/vrellis/works/knit.html"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-line hover:decoration-ink"
          >
            Petros Vrellis
          </a>
          {" "}published <em>A new way to knit</em>: a single black thread
          wrapped between 200 nails on a circular wooden hoop, 3,000 to
          4,000 times, in an order chosen by software. Each crossing
          darkens the region it passes through; the algorithm picks the
          next crossing to be wherever the image still needs darkening
          most. The output is a recognisable portrait of the source
          photograph, made from one continuous string.
        </p>
        <p>
          Most continuous-string portraits you see online use Vrellis's
          method or a close variant. Later work extends it to small
          fixed palettes (usually black plus red, yellow, blue) wound
          one spool at a time.
        </p>
      </section>

      <section className="flex flex-col gap-4 text-sm leading-relaxed text-ink">
        <h2 className="font-display text-lg">The algorithm</h2>
        <p>
          Start with a "darkness still needed" residual at every pixel.
          At each step, score every legal chord between two pins by the
          weighted sum of that residual along its path. Pick the
          highest-scoring chord. Subtract a thread's coverage from the
          residual at the pixels the chord crosses. Repeat a few
          thousand times, stopping when the line budget runs out.
        </p>
        <p>
          Vrellis's combination of low per-crossing opacity (about 3%),
          a few thousand chords, and greedy scoring is the reference
          most implementations follow.
        </p>
      </section>

      <section className="flex flex-col gap-4 text-sm leading-relaxed text-ink">
        <h2 className="font-display text-lg">What this site does</h2>
        <p>
          Upload a photo. The solver runs in your browser, compiled to
          WebAssembly. The loom shows the pattern as it is generated. The
          Build tab has a printable nail template, a pin-by-pin
          construction booklet, and a read-aloud mode for building the
          piece by hand. Images stay on your machine.
        </p>
      </section>

      <section className="flex flex-col gap-3 text-sm text-muted">
        <h2 className="font-display text-lg text-ink">Further reading</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <a
              href="http://artof01.com/vrellis/works/knit.html"
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink"
            >
              Petros Vrellis, <em>A new way to knit</em> (2016)
            </a>
          </li>
          <li>
            <a
              href="https://erikdemaine.org/fonts/stringart/"
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink"
            >
              Erik &amp; Martin Demaine, string-art fonts (MIT)
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
