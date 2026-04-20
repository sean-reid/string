import * as Comlink from "comlink";
import type { SolverWorkerApi } from "./types";

let worker: Worker | null = null;
let remote: Comlink.Remote<SolverWorkerApi> | null = null;

export function getSolverWorker(): Comlink.Remote<SolverWorkerApi> {
  if (!remote) {
    worker = new Worker(
      new URL("../workers/solver.worker.ts", import.meta.url),
      { type: "module", name: "solver-worker" },
    );
    remote = Comlink.wrap<SolverWorkerApi>(worker);
  }
  return remote;
}

/** Terminates the current solver worker so the next call spawns a fresh one. */
export function terminateSolverWorker(): void {
  worker?.terminate();
  worker = null;
  remote = null;
}
