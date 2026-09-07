import { migrateEntity } from "./migrate.ts";
import type { Envelope, Receipt } from "./commands.ts";
import { validateSong } from "./validate.ts";

// Old receipts retain their fingerprints so retries still match the original call.
export function hydrateEnvelope(e: Envelope): Envelope {
  const next = structuredClone(e);
  const upgrade = (s: unknown) => {
    const v = validateSong(s);
    if (!v.ok) throw new Error(`Stored song cannot be loaded: ${v.error}`);
    return v.value;
  };
  if (next.song) next.song = upgrade(next.song);
  for (const h of next.history) {
    if (h.deletedSong) h.deletedSong = upgrade(h.deletedSong);
    for (const d of h.deltas)
      for (const key of ["before", "after"] as const)
        d[key] = migrateEntity(d.table, d[key]);
  }
  return next;
}
export function historyStacks(history: Receipt[]) {
  const undo: string[] = [],
    redo: string[] = [];
  for (const h of history) {
    if (!h.deltas.length && h.beforeDeleted === h.afterDeleted) continue;
    const inverse = h.undoOf;
    if (inverse && redo.includes(inverse)) {
      redo.splice(redo.indexOf(inverse), 1);
      undo.push(h.operationId);
    } else if (inverse && undo.includes(inverse)) {
      undo.splice(undo.indexOf(inverse), 1);
      redo.push(h.operationId);
    } else {
      undo.push(h.operationId);
      redo.length = 0;
    }
  }
  return { undo, redo };
}
