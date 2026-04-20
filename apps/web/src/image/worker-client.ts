import * as Comlink from "comlink";
import type { ImageWorkerApi } from "./types";

let remote: Comlink.Remote<ImageWorkerApi> | null = null;
let worker: Worker | null = null;

export function getImageWorker(): Comlink.Remote<ImageWorkerApi> {
  if (!remote) {
    worker = new Worker(
      new URL("../workers/image.worker.ts", import.meta.url),
      { type: "module", name: "image-worker" },
    );
    remote = Comlink.wrap<ImageWorkerApi>(worker);
  }
  return remote;
}

export function terminateImageWorker(): void {
  worker?.terminate();
  worker = null;
  remote = null;
}
