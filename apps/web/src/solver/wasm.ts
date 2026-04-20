import init, * as solver from "@solver/solver";

type Solver = typeof solver;

let ready: Promise<Solver> | null = null;

export function getSolver(): Promise<Solver> {
  if (!ready) {
    ready = init().then(() => solver);
  }
  return ready;
}
