import type { Song, MusicalEvent, Occurrence } from "./model.ts";
import { placements, sectionSpans } from "./arrangement.ts";
import { segments, cycleStarts } from "./timeline.ts";
import { add, sub, mul, cmp, time, ZERO, type Time } from "./time.ts";
const key = (t: Time) => t.join("/");
const unique = (ts: Time[]) =>
  [...new Map(ts.map((t) => [key(t), t])).values()].sort(cmp);
function range(from: Time, until: Time) {
  for (const t of [from, until])
    if (
      !Array.isArray(t) ||
      t.length !== 2 ||
      key(time(t[0], t[1])) !== key(t) ||
      cmp(t, ZERO) < 0
    )
      throw new Error("Use normalized nonnegative range times");
  if (cmp(until, from) <= 0) throw new Error("Range end must follow start");
}
export function alignmentMap(s: Song, ids: string[], from: Time, until: Time) {
  range(from, until);
  if (
    !Array.isArray(ids) ||
    ids.length < 2 ||
    ids.length > 8 ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Select 2–8 distinct occurrences");
  const resolved = placements(s);
  let inspected = 0;
  const all = ids.map((id) => {
    const o = s.tables.occurrences[id];
    if (!o) throw new Error(`Unknown occurrence ${id}`);
    const starts: Time[] = [];
    for (const p of resolved.filter((p) => p.id === id)) {
      const points = cycleStarts(s, p);
      inspected += points.length;
      if (inspected > 100000)
        throw new Error("Alignment map is too dense; shorten the placements");
      for (const point of points) starts.push(point);
    }
    return {
      id,
      name: o.name,
      phase: o.phase,
      length: s.tables.patterns[o.patternId]!.length,
      starts: unique(starts).filter(
        (t) => cmp(t, from) >= 0 && cmp(t, until) <= 0,
      ),
    };
  });
  const sets = all.map((l) => new Set(l.starts.map(key)));
  const common = all[0]!.starts.filter((t) =>
    sets.every((set) => set.has(key(t))),
  );
  return {
    from,
    until,
    lanes: all.map((l) => ({
      ...l,
      total: l.starts.length,
      starts: l.starts.slice(0, 512),
    })),
    common: common.slice(0, 512),
    totalCommon: common.length,
    truncated: common.length > 512 || all.some((l) => l.starts.length > 512),
  };
}
function attacks(s: Song, o: Occurrence): Time[] {
  const out: Time[] = [];
  const events = Object.values(s.tables.events).filter(
    (e) => e.patternId === o.patternId && e.kind !== "rest",
  );
  let count = 0;
  for (const seg of segments(s, o))
    for (
      let cycle = sub(seg.start, seg.phase);
      cmp(cycle, seg.end) < 0;
      cycle = add(cycle, s.tables.patterns[o.patternId]!.length)
    ) {
      if (++count > 100000) throw new Error("Rhythm analysis is too dense");
      for (const e of events) {
        const t = add(cycle, e.start);
        if (cmp(t, seg.start) >= 0 && cmp(t, seg.end) < 0) out.push(t);
        if (out.length > 100000) throw new Error("Too many attacks to inspect");
      }
    }
  return unique(out);
}
export function polyrhythmGrid(s: Song, id: string) {
  const p = s.tables.polyrhythms[id];
  if (!p) throw new Error("Unknown polyrhythm");
  const offsets =
    p.sectionId === null
      ? [{ id: null, start: ZERO }]
      : sectionSpans(s).filter((a) => a.sectionId === p.sectionId);
  if (offsets.length > 512)
    throw new Error(
      "Too many polyrhythm appearances; inspect a smaller arrangement",
    );
  const resolved = placements(s);
  return offsets.map((a) => {
    const start = add(a.start, p.start),
      end = add(start, p.duration);
    return {
      appearanceId: a.id,
      start,
      duration: p.duration,
      lanes: p.lanes.map((l) => {
        const expected = Array.from({ length: l.divisions }, (_, i) =>
          add(start, mul(p.duration, [i, l.divisions])),
        );
        const actual = unique(
          resolved
            .filter((o) => o.id === l.occurrenceId && o.appearanceId === a.id)
            .flatMap((o) => attacks(s, o)),
        ).filter((t) => cmp(t, start) >= 0 && cmp(t, end) < 0);
        const expectedSet = new Set(expected.map(key)),
          actualSet = new Set(actual.map(key));
        return {
          ...l,
          expected,
          actual: actual.slice(0, 512),
          totalActual: actual.length,
          truncated: actual.length > 512,
          missing: expected.filter((t) => !actualSet.has(key(t))),
          extra: actual.filter((t) => !expectedSet.has(key(t))).slice(0, 512),
          matches:
            actual.length === expected.length &&
            expected.every((t) => actualSet.has(key(t))),
        };
      }),
    };
  });
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function comparePatterns(
  s: Song,
  sourceId: string,
  variationId: string,
) {
  const source = s.tables.patterns[sourceId],
    variation = s.tables.patterns[variationId];
  if (!source || !variation) throw new Error("Choose two existing patterns");
  const events = (id: string) =>
    Object.values(s.tables.events)
      .filter((e) => e.patternId === id)
      .sort((a, b) => cmp(a.start, b.start) || a.id.localeCompare(b.id));
  const left = events(sourceId),
    right = events(variationId);
  const lmap = new Map(left.map((e) => [e.originId, e])),
    rmap = new Map(right.map((e) => [e.originId, e]));
  const content = (e: MusicalEvent) =>
    e.kind === "chord"
      ? s.tables.chords[e.chordId!]!.notes.map((n) => ({
          id: n.id,
          pitch: n.pitch,
        }))
      : e.kind === "note"
        ? e.pitch
        : e.kind === "drum"
          ? e.drum
          : null;
  const rows = [...new Set([...lmap.keys(), ...rmap.keys()])].map(
    (originId) => {
      const before = lmap.get(originId) ?? null,
        after = rmap.get(originId) ?? null;
      const fields: string[] = [];
      if (before && after) {
        for (const field of [
          "kind",
          "start",
          "duration",
          "accent",
          "articulation",
          "performance",
        ] as const)
          if (!same(before[field], after[field])) fields.push(field);
        if (!same(content(before), content(after))) fields.push("notes");
        const label = (e: MusicalEvent) =>
          e.kind === "chord" ? s.tables.chords[e.chordId!]!.label : null;
        if (!same(label(before), label(after))) fields.push("interpretation");
      }
      return {
        originId,
        before,
        after,
        status: !before
          ? "added"
          : !after
            ? "removed"
            : fields.length
              ? "changed"
              : "unchanged",
        fields,
      };
    },
  );
  return {
    source,
    variation,
    cycleChanged: !same(source.length, variation.length),
    groupsChanged: !same(source.groups, variation.groups),
    rows,
  };
}
