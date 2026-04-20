import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section className="mx-auto flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-4xl tracking-tight">Lost thread</h1>
      <p className="text-muted">That page does not exist.</p>
      <Link to="/" className="text-accent hover:underline">
        Back to the loom
      </Link>
    </section>
  );
}
