import {
  noteEvent,
  type Song,
  type Table,
  type Entity,
} from "../song/model.ts";
import type { Change } from "../song/commands.ts";
const first = (o: Record<string, unknown>, label: string) => {
  const id = Object.keys(o)[0];
  if (!id) throw new Error(`Create a ${label} first`);
  return id;
};
export function entityChanges(table: Table, s: Song, id: string): Change[] {
  const t = s.tables;
  let item: unknown;
  const changes: Change[] = [];
  const base = { id, name: `New ${table.replace(/s$/, "")}` };
  switch (table) {
    case "parts":
      item = { ...base, instrument: "guitar", volume: 0.6, muted: false };
      break;
    case "voices":
      item = { ...base, partId: first(t.parts, "part") };
      break;
    case "patterns":
      item = { ...base, length: [4, 1], sourceId: null };
      break;
    case "chords":
      item = {
        ...base,
        name: "Tonic",
        label: "I",
        notes: [1, 3, 5].map((degree, i) => ({
          id: `member-${i}`,
          pitch: { degree, alteration: 0, octave: 0 },
        })),
      };
      break;
    case "events":
      item = noteEvent(id, first(t.patterns, "pattern"));
      break;
    case "sections":
      item = { ...base, barIds: [] };
      break;
    case "bars": {
      const sid = first(t.sections, "section");
      item = {
        ...base,
        sectionId: sid,
        numerator: 4,
        denominator: 4,
        groups: [1, 1, 1, 1],
        actual: null,
      };
      changes.push({
        table: "sections",
        id: sid,
        value: { ...t.sections[sid], barIds: [...t.sections[sid]!.barIds, id] },
      });
      break;
    }
    case "arrangement":
      item = { ...base, sectionId: first(t.sections, "section") };
      changes.push({
        table: "meta",
        id: "arrangementOrder",
        value: [...s.arrangementOrder, id],
      });
      break;
    case "occurrences":
      item = {
        ...base,
        patternId: first(t.patterns, "pattern"),
        voiceId: first(t.voices, "voice"),
        start: [0, 1],
        span: [16, 1],
        phase: [0, 1],
        boundary: "continue",
        tails: "ring",
      };
      break;
    case "markers":
      item = { ...base, at: [0, 1] };
      break;
  }
  return [{ table, id, value: item }, ...changes];
}
export function deleteChanges(table: Table, id: string, s: Song): Change[] {
  const changes: Change[] = [{ table, id, value: null }];
  if (table === "bars") {
    const bar = s.tables.bars[id]!;
    const sec = s.tables.sections[bar.sectionId]!;
    changes.push({
      table: "sections",
      id: sec.id,
      value: { ...sec, barIds: sec.barIds.filter((b) => b !== id) },
    });
  }
  if (table === "arrangement")
    changes.push({
      table: "meta",
      id: "arrangementOrder",
      value: s.arrangementOrder.filter((a) => a !== id),
    });
  return changes;
}
export function vary(s: Song, patternId: string, id: string): Change[] {
  const p = s.tables.patterns[patternId];
  if (!p) throw new Error("Select a pattern");
  return [
    {
      table: "patterns",
      id,
      value: { ...p, id, name: `${p.name} · variation`, sourceId: p.id },
    },
    ...Object.values(s.tables.events)
      .filter((e) => e.patternId === p.id)
      .map((e) => ({
        table: "events" as const,
        id: `${id}-${e.id}`,
        value: { ...e, id: `${id}-${e.id}`, patternId: id },
      })),
  ];
}
