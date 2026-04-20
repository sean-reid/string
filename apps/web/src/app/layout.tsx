import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useImageStore } from "@/image/store";
import { useSolverStore } from "@/solver/store";

export function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const resetImage = useImageStore((s) => s.reset);
  const resetSolver = useSolverStore((s) => s.reset);

  const goHome = (event: React.MouseEvent) => {
    event.preventDefault();
    resetSolver();
    resetImage();
    navigate("/");
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper text-ink antialiased">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <a
          href="/"
          onClick={goHome}
          className="font-display text-lg tracking-tight text-ink hover:text-accent"
          aria-label="String, back to the start"
        >
          string
        </a>
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
          <Link
            to="/about"
            aria-current={pathname === "/about" ? "page" : undefined}
            className="hover:text-ink aria-[current=page]:text-ink"
          >
            About
          </Link>
        </nav>
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
