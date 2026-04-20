import { Link, Outlet, useLocation } from "react-router";

export function Layout() {
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper text-ink antialiased">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <Link
          to="/"
          className="font-display text-lg tracking-tight text-ink hover:text-accent"
          aria-label="String, home"
        >
          string
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted">
          <Link
            to="/"
            aria-current={pathname === "/" ? "page" : undefined}
            className="hover:text-ink aria-[current=page]:text-ink"
          >
            Compose
          </Link>
          <Link
            to="/build"
            aria-current={pathname === "/build" ? "page" : undefined}
            className="hover:text-ink aria-[current=page]:text-ink"
          >
            Build
          </Link>
        </nav>
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
