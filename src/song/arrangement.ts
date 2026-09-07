import type { Song, Occurrence } from "./model.ts";
import { add, time, ZERO, type Time } from "./time.ts";

export function sectionLength(s: Song, id: string): Time {
  const section = s.tables.sections[id];
  if (!section) throw new Error(`Unknown section ${id}`);
  return section.barIds.reduce((n, id) => {
    const b = s.tables.bars[id]!;
    return add(n, b.actual ?? time(b.numerator * 4, b.denominator));
  }, ZERO);
}
export function sectionSpans(s: Song) {
  let at = ZERO;
  return s.arrangementOrder.map((id) => {
    const a = s.tables.arrangement[id]!;
    const start = at,
      length = sectionLength(s, a.sectionId);
    at = add(at, length);
    return { ...a, start, length };
  });
}
export interface Placement extends Occurrence {
  appearanceId: string | null;
}
export function placements(s: Song): Placement[] {
  const spans = sectionSpans(s);
  const out: Placement[] = [];
  for (const o of Object.values(s.tables.occurrences)) {
    if (o.sectionId === null) out.push({ ...o, appearanceId: null });
    else
      for (const a of spans)
        if (a.sectionId === o.sectionId) {
          out.push({ ...o, start: add(a.start, o.start), appearanceId: a.id });
          if (out.length > 100000)
            throw new Error("Too many arranged placements");
        }
  }
  return out;
}
export function annotations(s: Song) {
  const out: {
    table: "phrases" | "lyrics";
    id: string;
    name: string;
    start: Time;
    duration: Time;
    appearanceId: string;
  }[] = [];
  for (const a of sectionSpans(s))
    for (const table of ["phrases", "lyrics"] as const)
      for (const e of Object.values(s.tables[table]))
        if (e.sectionId === a.sectionId) {
          out.push({
            table,
            id: e.id,
            name: e.name,
            start: add(a.start, e.start),
            duration: e.duration,
            appearanceId: a.id,
          });
          if (out.length > 100000)
            throw new Error("Too many arranged annotations");
        }
  return out;
}
