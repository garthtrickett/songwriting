import { takePlacements } from "./media.ts";
import { harmonicSpans } from "./harmony-analysis.ts";
import { harmonyChanges, type HarmonyAction } from "./harmony.ts";
import { rhythmChanges, type RhythmAction } from "./rhythm.ts";
import { structureChanges, type StructureAction } from "./structure.ts";
import { sectionSpans, annotations } from "./arrangement.ts";
import { TABLES, type Song, type Table } from "./model.ts";
import { sounds } from "./timeline.ts";
import { validateSong } from "./validate.ts";
export type Change = { table: Table | "meta"; id: string; value: unknown };
export type Command =
  | { kind: "harmony"; action: HarmonyAction }
  | { kind: "edit"; changes: Change[] }
  | { kind: "replace"; song: unknown }
  | { kind: "delete" }
  | { kind: "rhythm"; action: RhythmAction }
  | { kind: "structure"; action: StructureAction }
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
  undoOf?: string;
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
    ![
      "edit",
      "replace",
      "delete",
      "undo",
      "structure",
      "rhythm",
      "harmony",
    ].includes(m.command.kind)
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
    case "harmony":
      if (!next) throw new Error("Song does not exist");
      for (const change of harmonyChanges(next, m.command.action))
        write(next, change);
      break;
    case "rhythm":
      if (!next) throw new Error("Song does not exist");
      for (const change of rhythmChanges(next, m.command.action))
        write(next, change);
      break;
    case "structure":
      if (!next) throw new Error("Song does not exist");
      for (const change of structureChanges(next, m.command.action))
        write(next, change);
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
    annotations(next);
    harmonicSpans(next);
    takePlacements(next);
  }
  const revision = (current?.revision ?? 0) + 1;
  const receipt: Receipt = {
    ...(m.command.kind === "undo" ? { undoOf: m.command.targetId } : {}),
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

export function previewCommand(current: Envelope, command: Command) {
  const next = applyCommand(
    current,
    {
      songId: current.id,
      expectedRevision: current.revision,
      operationId: "preview",
      label: "Preview",
      command,
    },
    0,
  );
  const changes = next.history.at(-1)!.deltas;
  const patternIds = new Set(
    changes.flatMap((d) =>
      d.table === "patterns"
        ? [d.id]
        : d.table === "events"
          ? [((d.after ?? d.before) as { patternId: string }).patternId]
          : [],
    ),
  );
  const chordIds = new Set(
    changes.filter((d) => d.table === "chords").map((d) => d.id),
  );
  for (const e of Object.values(next.song?.tables.events ?? {}))
    if (e.chordId && chordIds.has(e.chordId)) patternIds.add(e.patternId);
  return {
    affectedPlacements: Object.values(next.song?.tables.occurrences ?? {})
      .filter(
        (o) =>
          patternIds.has(o.patternId) ||
          changes.some((d) => d.table === "occurrences" && d.id === o.id),
      )
      .map((o) => ({ id: o.id, name: o.name, patternId: o.patternId })),
    revision: current.revision,
    changes: next.history.at(-1)!.deltas,
    sections: next.song ? sectionSpans(next.song) : [],
    fixedGlobalPlacements: Object.values(next.song?.tables.occurrences ?? {})
      .filter((o) => o.sectionId === null)
      .map((o) => ({ id: o.id, name: o.name, start: o.start, span: o.span })),
  };
}
