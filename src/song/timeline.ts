import type { Song, Pitch, Occurrence } from "./model.ts";
import { add, sub, mul, cmp, time, value, ZERO, type Time } from "./time.ts";
export interface BarSpan {
  id: string;
  sectionOccurrenceId: string;
  index: number;
  start: Time;
  length: Time;
  numerator: number;
  denominator: number;
  groups: number[];
}
export function bars(s: Song): BarSpan[] {
  const out: BarSpan[] = [];
  let start: Time = ZERO;
  for (const aid of s.arrangementOrder) {
    const a = s.tables.arrangement[aid]!;
    for (const id of s.tables.sections[a.sectionId]!.barIds) {
      const b = s.tables.bars[id]!;
      const length = b.actual ?? time(b.numerator * 4, b.denominator);
      out.push({
        id,
        sectionOccurrenceId: aid,
        index: out.length,
        start,
        length,
        numerator: b.numerator,
        denominator: b.denominator,
        groups: b.groups,
      });
      start = add(start, length);
    }
  }
  return out;
}
export const songEnd = (s: Song): Time => {
  let end: Time = ZERO;
  for (const b of bars(s)) end = add(b.start, b.length);
  for (const o of Object.values(s.tables.occurrences)) {
    const e = add(o.start, o.span);
    if (cmp(e, end) > 0) end = e;
  }
  return end;
};
interface Segment {
  start: Time;
  end: Time;
  phase: Time;
}
export function segments(s: Song, o: Occurrence): Segment[] {
  const end = add(o.start, o.span);
  const boundaries = bars(s)
    .filter(
      (b, i, a) =>
        i > 0 &&
        b.sectionOccurrenceId !== a[i - 1]!.sectionOccurrenceId &&
        cmp(b.start, o.start) > 0 &&
        cmp(b.start, end) < 0,
    )
    .map((b) => b.start);
  if (o.boundary === "continue" || boundaries.length === 0)
    return [{ start: o.start, end, phase: o.phase }];
  if (o.boundary === "stop")
    return [{ start: o.start, end: boundaries[0]!, phase: o.phase }];
  const points = [o.start, ...boundaries, end];
  return points
    .slice(0, -1)
    .map((p, i) => ({
      start: p,
      end: points[i + 1]!,
      phase: i === 0 ? o.phase : ZERO,
    }));
}
export interface Sound {
  id: string;
  occurrenceId: string;
  eventId: string;
  voiceId: string;
  partId: string;
  start: Time;
  duration: Time;
  pitch: Pitch | null;
  drum: "kick" | "snare" | "hat";
  gain: number;
  instrument: "guitar" | "bass" | "drums";
}
export function sounds(s: Song): Sound[] {
  const out: Sound[] = [];
  let iterations = 0;
  for (const o of Object.values(s.tables.occurrences)) {
    const pattern = s.tables.patterns[o.patternId]!;
    const voice = s.tables.voices[o.voiceId]!;
    const part = s.tables.parts[voice.partId]!;
    if (part.muted) continue;
    const events = Object.values(s.tables.events).filter(
      (e) => e.patternId === pattern.id,
    );
    for (const seg of segments(s, o))
      for (
        let cycle = sub(seg.start, seg.phase);
        cmp(cycle, seg.end) < 0;
        cycle = add(cycle, pattern.length)
      ) {
        if (++iterations > 100000)
          throw new Error(
            "Timeline is too dense to expand; shorten the selected occurrences",
          );
        for (const e of events) {
          if (e.kind === "rest") continue;
          const attack = add(cycle, e.start);
          const notes =
            e.kind === "chord"
              ? s.tables.chords[e.chordId!]!.notes.map((n) => ({
                  pitch: n.pitch,
                  member: n.id,
                }))
              : [{ pitch: e.kind === "drum" ? null : e.pitch, member: "" }];
          for (const n of notes) {
            const perf = e.performance.find((p) => p.memberId === n.member);
            const start = add(attack, perf?.offset ?? ZERO);
            if (cmp(start, seg.start) < 0 || cmp(start, seg.end) >= 0) continue;
            let duration = perf?.duration ?? e.duration;
            if (e.articulation === "staccato") duration = mul(duration, [1, 2]);
            if (o.tails === "cut" && cmp(add(start, duration), seg.end) > 0)
              duration = sub(seg.end, start);
            out.push({
              id: `${o.id}:${e.id}:${n.member}:${start}`,
              occurrenceId: o.id,
              eventId: e.id,
              voiceId: voice.id,
              partId: part.id,
              start,
              duration,
              pitch: n.pitch,
              drum: e.drum,
              instrument: part.instrument,
              gain:
                part.volume *
                e.accent *
                (e.articulation === "ghost" ? 0.25 : 1) *
                (e.articulation === "muted" ? 0.45 : 1),
            });
            if (out.length > 100000) throw new Error("Too many sounding notes");
          }
        }
      }
  }
  const rests = restSpans(s);
  const audible: Sound[] = [];
  for (const n of out) {
    let end = add(n.start, n.duration);
    let silent = false;
    for (const r of rests) {
      if (r.voiceId !== n.voiceId) continue;
      const restEnd = add(r.start, r.duration);
      if (cmp(n.start, r.start) >= 0 && cmp(n.start, restEnd) < 0) {
        silent = true;
        break;
      }
      if (cmp(r.start, n.start) > 0 && cmp(r.start, end) < 0) end = r.start;
    }
    if (!silent) audible.push({ ...n, duration: sub(end, n.start) });
  }
  return audible.sort((a, b) => cmp(a.start, b.start));
}
export function alignment(
  s: Song,
  ids: string[],
  after: Time,
  until: Time,
): Time | null {
  if (ids.length < 2) throw new Error("Select at least two occurrences");
  const sets = ids.map((id) => {
    const o = s.tables.occurrences[id];
    if (!o) throw new Error(`Unknown occurrence ${id}`);
    const times = new Map<string, Time>();
    let count = 0;
    for (const seg of segments(s, o))
      for (
        let t = sub(seg.start, seg.phase);
        cmp(t, seg.end) < 0 && cmp(t, until) <= 0;
        t = add(t, s.tables.patterns[o.patternId]!.length)
      ) {
        if (++count > 100000) throw new Error("Alignment range too dense");
        if (cmp(t, seg.start) >= 0 && cmp(t, after) > 0)
          times.set(t.join("/"), t);
      }
    return times;
  });
  for (const [key, t] of sets[0]!)
    if (sets.every((set) => set.has(key))) return t;
  return null;
}
export const secondsPerQuarter = (s: Song) =>
  60 / (s.tempo.bpm * value(s.tempo.beatUnit));
export function clicks(s: Song): { at: Time; strong: boolean }[] {
  return bars(s).flatMap((b) => {
    let offset: Time = ZERO;
    return b.groups.map((g, i) => {
      const at = add(b.start, offset);
      offset = add(offset, time(g * 4, b.denominator));
      return { at, strong: i === 0 };
    });
  });
}

export function cycleStarts(s: Song, o: Occurrence): Time[] {
  const starts: Time[] = [];
  let count = 0;
  for (const seg of segments(s, o))
    for (
      let at = sub(seg.start, seg.phase);
      cmp(at, seg.end) < 0;
      at = add(at, s.tables.patterns[o.patternId]!.length)
    ) {
      if (++count > 100000) throw new Error("Pattern is too dense");
      if (cmp(at, seg.start) >= 0) starts.push(at);
    }
  return starts;
}
export function restSpans(
  s: Song,
): { eventId: string; voiceId: string; start: Time; duration: Time }[] {
  const out: {
    eventId: string;
    voiceId: string;
    start: Time;
    duration: Time;
  }[] = [];
  let count = 0;
  for (const o of Object.values(s.tables.occurrences)) {
    const events = Object.values(s.tables.events).filter(
      (e) => e.patternId === o.patternId && e.kind === "rest",
    );
    if (!events.length) continue;
    for (const seg of segments(s, o))
      for (
        let at = sub(seg.start, seg.phase);
        cmp(at, seg.end) < 0;
        at = add(at, s.tables.patterns[o.patternId]!.length)
      ) {
        if (++count > 100000) throw new Error("Rest timeline is too dense");
        for (const e of events) {
          const start = add(at, e.start);
          if (cmp(start, seg.start) < 0 || cmp(start, seg.end) >= 0) continue;
          const end = add(start, e.duration);
          out.push({
            eventId: e.id,
            voiceId: o.voiceId,
            start,
            duration: cmp(end, seg.end) > 0 ? sub(seg.end, start) : e.duration,
          });
        }
      }
  }
  return out;
}
