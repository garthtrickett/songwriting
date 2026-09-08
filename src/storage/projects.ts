import { hydrateEnvelope } from "../song/history.ts";
import {
  applyCommand,
  type Mutation,
  type Envelope,
} from "../song/commands.ts";
import { attemptAsync, type Result } from "../result.ts";
export function openDb(name = "songwriting-v1"): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => {
      for (const store of ["songs", "sessions", "settings", "media", "captures"])
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}
export function read<T>(
  db: IDBDatabase,
  store: string,
  id: string,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(id);
    r.onsuccess = () => {
      try {
        resolve(
          store === "songs" && r.result
            ? (hydrateEnvelope(r.result) as T)
            : (r.result as T | undefined),
        );
      } catch (e) {
        reject(e);
      }
    };
    r.onerror = () => reject(r.error);
  });
}
export function list<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => {
      try {
        resolve(
          store === "songs"
            ? ((r.result as Envelope[]).map(hydrateEnvelope) as T[])
            : (r.result as T[]),
        );
      } catch (e) {
        reject(e);
      }
    };
    r.onerror = () => reject(r.error);
  });
}
export function save<T extends { id: string }>(
  db: IDBDatabase,
  store: string,
  item: T,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(item);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
export function commit(
  db: IDBDatabase,
  m: Mutation,
  options?: CommitOptions,
): Promise<Result<Envelope>> {
  return attemptAsync(
    () =>
      new Promise<Envelope>((resolve, reject) => {
        const tx = db.transaction(options?.receipt ? ["songs", "sessions"] : ["songs"], "readwrite");
        const store = tx.objectStore("songs");
        const request = store.get(m.songId);
        let result: Envelope;
        let failure: unknown;
        request.onsuccess = () => {
          try {
            if (options?.active && !options.active()) throw new Error("The operation was stopped before saving.");
            const old = request.result
              ? hydrateEnvelope(request.result as Envelope)
              : undefined;
            const duplicate = old?.history.find(
              (h) => h.operationId === m.operationId,
            );
            if (duplicate) {
              if (duplicate.fingerprint !== JSON.stringify(m))
                throw new Error("Operation ID reused with different content");
              result = old!;
            } else {
              result = applyCommand(old, m, Date.now());
              store.put(result);
            }
            // A delivery record and its musical effect become durable together.
            // The callback is synchronous and must only build the receipt data.
            if (options?.receipt) tx.objectStore("sessions").put(options.receipt(result));
          } catch (e) {
            failure = e;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () =>
          reject(failure ?? tx.error ?? new Error("Save aborted"));
        tx.onerror = () => {
          failure ??= tx.error;
        };
      }),
  );
}
export interface CommitOptions {
  active?: () => boolean;
  receipt?: (envelope: Envelope) => { id: string };
}
