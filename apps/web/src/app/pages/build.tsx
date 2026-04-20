export function BuildPage() {
  return (
    <section
      aria-label="Construction guide"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6"
    >
      <header>
        <h1 className="font-display text-3xl tracking-tight">Construction guide</h1>
        <p className="mt-2 text-muted">
          Step-by-step pattern for building the piece by hand. Generate something
          on the Compose tab and it will appear here.
        </p>
      </header>
      <div
        className="flex h-64 items-center justify-center rounded-xl border border-dashed border-line text-muted"
        role="status"
      >
        Nothing to build yet.
      </div>
    </section>
  );
}
