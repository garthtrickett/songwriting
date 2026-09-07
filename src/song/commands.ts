import { TABLES, type Song, type Table } from "./model.ts";
import { sounds } from "./timeline.ts";
import { validateSong } from "./validate.ts";
export type Change = { table: Table | "meta"; id: string; value: unknown };
export type Command =
  | { kind: "edit"; changes: Change[] }
  | { kind: "replace"; song: unknown }
  | { kind: "delete" }
  | { kind: "undo"; targetId: string };
export interface Mutation {
  songId: string;
  expectedRevision: number;
  operationId: string;
  label: string;
  command: Command;
}
export interface Delta {
  table: Table | "meta";
  id: string;
  before: unknown;
  after: unknown;
}
export interface Receipt {
  operationId: string;
  fingerprint: string;
  label: string;
  revision: number;
  deltas: Delta[];
  beforeDeleted: boolean;
  afterDeleted: boolean;
  deletedSong: Song | null;
  at: number;
}
export interface Envelope {
  id: string;
  revision: number;
  song: Song | null;
  updatedAt: number;
  history: Receipt[];
}
export const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const META = ["title", "mode", "tempo", "arrangementOrder"];
function write(s: Song, c: Change): void {
  if (c.table === "meta") {
    if (!META.includes(c.id)) throw new Error(`Cannot edit metadata ${c.id}`);
    (s as unknown as Record<string, unknown>)[c.id] = structuredClone(c.value);
  } else {
    if (
      !(TABLES as readonly string[]).includes(c.table) ||
      ["__proto__", "constructor", "prototype"].includes(c.id)
    )
      throw new Error("Invalid entity path");
    const target = s.tables[c.table] as Record<string, unknown>;
    if (c.value === null) delete target[c.id];
    else target[c.id] = structuredClone(c.value);
  }
}
export function difference(a: Song | null, b: Song | null): Delta[] {
  const out: Delta[] = [];
  for (const table of ["meta", ...TABLES] as const) {
    const left: Record<string, unknown> =
      table === "meta"
        ? Object.fromEntries(
            META.map((k) => [
              k,
              (a as unknown as Record<string, unknown> | null)?.[k] ?? null,
            ]),
          )
        : (a?.tables[table] ?? {});
    const right: Record<string, unknown> =
      table === "meta"
        ? Object.fromEntries(
            META.map((k) => [
              k,
              (b as unknown as Record<string, unknown> | null)?.[k] ?? null,
            ]),
          )
        : (b?.tables[table] ?? {});
    for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const before = left[id] ?? null,
        after = right[id] ?? null;
      if (!equal(before, after)) out.push({ table, id, before, after });
    }
  }
  return out;
}
export function applyCommand(
  current: Envelope | undefined,
  m: Mutation,
  now: number,
): Envelope {
  if (
    !m ||
    typeof m.operationId !== "string" ||
    !m.operationId ||
    typeof m.label !== "string" ||
    !m.label ||
    !Number.isSafeInteger(m.expectedRevision) ||
    m.expectedRevision < 0 ||
    typeof m.songId !== "string" ||
    !m.command ||
    !["edit", "replace", "delete", "undo"].includes(m.command.kind)
  )
    throw new Error(
      "Invalid mutation: identity, revision, label and command are required",
    );
  if ((current?.revision ?? 0) !== m.expectedRevision)
    throw new Error(
      `Revision conflict: expected ${m.expectedRevision}, current ${current?.revision ?? 0}. Refresh before editing.`,
    );
  const before = current?.song ?? null;
  let next = before ? structuredClone(before) : null;
  switch (m.command.kind) {
    case "replace": {
      const valid = validateSong(m.command.song);
      if (!valid.ok) throw new Error(valid.error);
      if (valid.value.id !== m.songId)
        throw new Error("Imported song ID must match target");
      next = valid.value;
      break;
    }
    case "edit":
      if (!next) throw new Error("Song does not exist");
      for (const c of m.command.changes) write(next, c);
      break;
    case "delete":
      if (!next) throw new Error("Song does not exist");
      next = null;
      break;
    case "undo": {
      const undo = m.command;
      const entry = current?.history.find(
        (h) => h.operationId === undo.targetId,
      );
      if (!entry) throw new Error("Unknown change to undo");
      if (entry.beforeDeleted) {
        if (!equal(difference(null, next), entry.deltas))
          throw new Error("Undo conflict: created song has newer edits");
        next = null;
        break;
      }
      if (entry.afterDeleted) {
        if (next) throw new Error("Undo conflict: song has been restored");
        next = structuredClone(entry.deletedSong);
        break;
      }
      if (!next) throw new Error("Song does not exist");
      for (const d of entry.deltas) {
        const actual =
          d.table === "meta"
            ? (next as unknown as Record<string, unknown>)[d.id]
            : ((next.tables[d.table] as Record<string, unknown>)[d.id] ?? null);
        if (!equal(actual, d.after))
          throw new Error(
            `Undo conflict at ${d.table}/${d.id}: changed since this operation`,
          );
      }
      for (const d of entry.deltas) write(next, { ...d, value: d.before });
      break;
    }
  }
  if (next && before) {
    for (const chord of Object.values(next.tables.chords ?? {})) {
      const old = before.tables.chords[chord.id];
      if (old && !equal(old.notes, chord.notes) && old.label === chord.label)
        chord.label = null;
    }
  }
  if (next) {
    const valid = validateSong(next);
    if (!valid.ok) throw new Error(valid.error);
    next = valid.value;
    sounds(next);
  }
  const revision = (current?.revision ?? 0) + 1;
  const receipt: Receipt = {
    operationId: m.operationId,
    fingerprint: JSON.stringify(m),
    label: m.label,
    revision,
    deltas: difference(before, next),
    beforeDeleted: before === null,
    afterDeleted: next === null,
    deletedSong: next === null ? before : null,
    at: now,
  };
  return {
    id: m.songId,
    revision,
    song: next,
    updatedAt: now,
    history: [...(current?.history ?? []), receipt],
  };
}
