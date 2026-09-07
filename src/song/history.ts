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
  const legacy =
    next.song?.schemaVersion === (1 as number) ||
    next.history.some((h) => h.deletedSong?.schemaVersion === (1 as number));
  if (next.song) next.song = upgrade(next.song);
  for (const h of next.history) {
    if (h.deletedSong) h.deletedSong = upgrade(h.deletedSong);
    if (legacy)
      for (const d of h.deltas)
        for (const key of ["before", "after"] as const) {
          const v = d[key];
          if (v && typeof v === "object" && !Array.isArray(v)) {
            if (d.table === "sections") d[key] = { ...v, sourceId: null };
            if (d.table === "occurrences") d[key] = { ...v, sectionId: null };
          }
        }
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
