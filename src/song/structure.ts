import type { Song, Table } from "./model.ts";
import type { Change } from "./commands.ts";
import { sectionSpans } from "./arrangement.ts";
import { sub, cmp } from "./time.ts";

export type StructureAction =
  | { type: "repeat"; appearanceId: string; newId: string }
  | { type: "move"; appearanceId: string; direction: -1 | 1 }
  | { type: "remove"; appearanceId: string }
  | { type: "variation"; appearanceId: string; newId: string; name: string }
  | { type: "attach"; appearanceId: string; occurrenceId: string };

// Mechanical transformations only: the caller chooses what music to change.
export function structureChanges(s: Song, action: StructureAction): Change[] {
  const a = s.tables.arrangement[action.appearanceId];
  if (!a) throw new Error("Select an arranged section");
  const order = [...s.arrangementOrder],
    index = order.indexOf(a.id);
  const changes: Change[] = [];
  const put = (table: Table, id: string, value: unknown) =>
    changes.push({ table, id, value });
  const fresh = (id: string) => {
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
      ["__proto__", "constructor", "prototype"].includes(id)
    )
      throw new Error(
        "New ID must be 1–100 letters, digits, underscores or hyphens",
      );
    if (Object.values(s.tables).some((table) => Object.hasOwn(table, id)))
      throw new Error(`ID already exists: ${id}`);
  };
  switch (action.type) {
    case "repeat":
      fresh(action.newId);
      put("arrangement", action.newId, { ...a, id: action.newId });
      order.splice(index + 1, 0, action.newId);
      break;
    case "move": {
      if (action.direction !== -1 && action.direction !== 1)
        throw new Error("Direction must be -1 or 1");
      const to = index + action.direction;
      if (to < 0 || to >= order.length)
        throw new Error("Section is already at the edge");
      [order[index], order[to]] = [order[to]!, order[index]!];
      break;
    }
    case "remove":
      put("arrangement", a.id, null);
      order.splice(index, 1);
      break;
    case "attach": {
      const o = s.tables.occurrences[action.occurrenceId];
      if (!o || o.sectionId !== null)
        throw new Error("Choose a global placement to attach");
      const span = sectionSpans(s).find((span) => span.id === a.id)!;
      if (cmp(o.start, span.start) < 0)
        throw new Error("Placement begins before this section");
      put("occurrences", o.id, {
        ...o,
        sectionId: a.sectionId,
        start: sub(o.start, span.start),
      });
      break;
    }
    case "variation": {
      fresh(action.newId);
      if (action.newId.length > 70)
        throw new Error("Variation ID must be at most 70 characters");
      const sec = s.tables.sections[a.sectionId]!;
      const ids = new Map<string, string>();
      let n = 0;
      const copied = (table: Table, id: string): string => {
        const key = `${table}/${id}`;
        const existing = ids.get(key);
        if (existing) return existing;
        const next = `${action.newId}-${++n}`;
        fresh(next);
        ids.set(key, next);
        return next;
      };
      const bars = sec.barIds.map((id) => {
        const next = copied("bars", id);
        put("bars", next, {
          ...s.tables.bars[id],
          id: next,
          sectionId: action.newId,
        });
        return next;
      });
      put("sections", action.newId, {
        ...sec,
        id: action.newId,
        name: action.name,
        sourceId: sec.id,
        barIds: bars,
      });
      for (const p of Object.values(s.tables.phrases).filter(
        (p) => p.sectionId === sec.id,
      )) {
        const id = copied("phrases", p.id);
        put("phrases", id, { ...p, id, sectionId: action.newId });
      }
      for (const l of Object.values(s.tables.lyrics).filter(
        (l) => l.sectionId === sec.id,
      )) {
        const id = copied("lyrics", l.id);
        put("lyrics", id, {
          ...l,
          id,
          sectionId: action.newId,
          phraseId: l.phraseId === null ? null : copied("phrases", l.phraseId),
        });
      }
      const local = Object.values(s.tables.occurrences).filter(
        (o) => o.sectionId === sec.id,
      );
      const patternIds = new Set(local.map((o) => o.patternId));
      const chordIds = new Set(
        Object.values(s.tables.events)
          .filter((e) => patternIds.has(e.patternId) && e.chordId !== null)
          .map((e) => e.chordId!),
      );
      for (const cid of chordIds) {
        const id = copied("chords", cid);
        put("chords", id, { ...s.tables.chords[cid], id });
      }
      for (const pid of patternIds) {
        const id = copied("patterns", pid);
        put("patterns", id, { ...s.tables.patterns[pid], id, sourceId: pid });
      }
      for (const e of Object.values(s.tables.events).filter((e) =>
        patternIds.has(e.patternId),
      )) {
        const id = copied("events", e.id);
        put("events", id, {
          ...e,
          id,
          patternId: copied("patterns", e.patternId),
          chordId: e.chordId === null ? null : copied("chords", e.chordId),
        });
      }
      for (const o of local) {
        const id = copied("occurrences", o.id);
        put("occurrences", id, {
          ...o,
          id,
          sectionId: action.newId,
          patternId: copied("patterns", o.patternId),
        });
      }
      for (const p of Object.values(s.tables.polyrhythms).filter(
        (p) => p.sectionId === sec.id,
      )) {
        const id = copied("polyrhythms", p.id);
        put("polyrhythms", id, {
          ...p,
          id,
          sectionId: action.newId,
          lanes: p.lanes.map((l) => ({
            ...l,
            occurrenceId: copied("occurrences", l.occurrenceId),
          })),
        });
      }
      put("arrangement", a.id, {
        ...a,
        name: action.name,
        sectionId: action.newId,
      });
      break;
    }
    default:
      throw new Error("Unknown structural action");
  }
  if (
    order.some((id, i) => id !== s.arrangementOrder[i]) ||
    order.length !== s.arrangementOrder.length
  )
    changes.push({ table: "meta", id: "arrangementOrder", value: order });
  return changes;
}
