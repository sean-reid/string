/**
 * Stores source image blobs in IndexedDB keyed by content hash. Used to
 * rehydrate the loom after a page reload without making the user re-upload.
 */

const DB_NAME = "string.blobs";
const DB_VERSION = 1;
const STORE = "sources";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const request = fn(store);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
      tx.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function cacheBlob(hash: string, blob: Blob): Promise<unknown> {
  return runTransaction("readwrite", (store) => store.put(blob, hash));
}

export async function getCachedBlob(hash: string): Promise<Blob | null> {
  return (await runTransaction<Blob>("readonly", (store) => store.get(hash))) ?? null;
}

export async function clearCachedBlobs(): Promise<void> {
  await runTransaction("readwrite", (store) => store.clear());
}
