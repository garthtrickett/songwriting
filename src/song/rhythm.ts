import { noteEvent, type Song, type Table, type Pitch } from "./model.ts";
import type { Change } from "./commands.ts";
import { add, sub, mul, modulo, cmp, ZERO, time, type Time } from "./time.ts";
export type RhythmAction =
  | { type: "variation"; patternId: string; newId: string; name: string }
  | { type: "displace"; occurrenceId: string; amount: Time }
  | { type: "phase"; occurrenceId: string; amount: Time }
  | { type: "rotate"; patternId: string; amount: Time }
  | { type: "accents"; patternId: string; steps: number }
  | {
      type: "scale";
      patternId: string;
      factor: Time;
      releases: "scale" | "preserve";
      phases: "follow" | "keep";
    }
  | {
      type: "splice";
      patternId: string;
      at: Time;
      amount: Time;
      mode: "insert" | "remove";
      attacks: "reject" | "delete";
      phases: "follow" | "keep";
    }
  | {
      type: "polyrhythm";
      newId: string;
      name: string;
      sectionId: string | null;
      start: Time;
      duration: Time;
      noteDuration: Time;
      lanes: {
        voiceId: string;
        divisions: number;
        pitch: Pitch;
        drum: "kick" | "snare" | "hat";
      }[];
    };

function exact(t: Time, positive = false) {
  if (!Array.isArray(t) || t.length !== 2)
    throw new Error("Use an exact [numerator, denominator]");
  const n = time(t[0], t[1]);
  if (
    cmp(n, t) !== 0 ||
    n[0] !== t[0] ||
    n[1] !== t[1] ||
    (positive && cmp(t, ZERO) <= 0)
  )
    throw new Error(
      "Use normalized time; durations and factors must be positive",
    );
}
export function rhythmChanges(s: Song, a: RhythmAction): Change[] {
  const changes: Change[] = [];
  const put = (table: Table, id: string, value: unknown) =>
    changes.push({ table, id, value });
  const fresh = (id: string) => {
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
      ["__proto__", "constructor", "prototype"].includes(id)
    )
      throw new Error("Invalid new ID");
    if (Object.values(s.tables).some((t) => Object.hasOwn(t, id)))
      throw new Error(`ID already exists: ${id}`);
    return id;
  };
  if (a.type === "polyrhythm" || a.type === "variation") {
    fresh(a.newId);
    if (a.newId.length > 70)
      throw new Error("New ID must be at most 70 characters");
  }
  if (a.type === "polyrhythm") {
    exact(a.start);
    exact(a.duration, true);
    exact(a.noteDuration, true);
    if (!Array.isArray(a.lanes) || a.lanes.length < 2 || a.lanes.length > 8)
      throw new Error("Choose 2–8 voices");
    const lanes = a.lanes.map((lane, i) => {
      const voice = s.tables.voices[lane.voiceId];
      if (!voice) throw new Error("Unknown voice");
      if (
        !Number.isInteger(lane.divisions) ||
        lane.divisions < 1 ||
        lane.divisions > 64
      )
        throw new Error("Divisions must be 1–64");
      const patternId = fresh(`${a.newId}-p${i}`),
        occurrenceId = fresh(`${a.newId}-o${i}`);
      const step = mul(a.duration, [1, lane.divisions]);
      put("patterns", patternId, {
        id: patternId,
        name: `${a.name} · ${lane.divisions}`,
        length: a.duration,
        groups: Array.from({ length: lane.divisions }, () => step),
        sourceId: null,
      });
      for (let j = 0; j < lane.divisions; j++) {
        const id = fresh(`${a.newId}-e${i}-${j}`);
        put("events", id, {
          ...noteEvent(id, patternId),
          name: `Pulse ${j + 1}`,
          start: mul(step, [j, 1]),
          duration: a.noteDuration,
          pitch: lane.pitch,
          kind:
            s.tables.parts[voice.partId]!.instrument === "drums"
              ? "drum"
              : "note",
          drum: lane.drum,
        });
      }
      put("occurrences", occurrenceId, {
        id: occurrenceId,
        name: `${a.name} · ${voice.name}`,
        sectionId: a.sectionId,
        patternId,
        voiceId: lane.voiceId,
        start: a.start,
        span: a.duration,
        phase: ZERO,
        boundary: "continue",
        tails: "ring",
      });
      return { occurrenceId, divisions: lane.divisions };
    });
    put("polyrhythms", a.newId, {
      id: a.newId,
      name: a.name,
      sectionId: a.sectionId,
      start: a.start,
      duration: a.duration,
      lanes,
    });
    return changes;
  }
  if (a.type === "displace" || a.type === "phase") {
    exact(a.amount);
    const o = s.tables.occurrences[a.occurrenceId];
    if (!o) throw new Error("Unknown occurrence");
    put(
      "occurrences",
      o.id,
      a.type === "displace"
        ? { ...o, start: add(o.start, a.amount) }
        : {
            ...o,
            phase: modulo(
              add(o.phase, a.amount),
              s.tables.patterns[o.patternId]!.length,
            ),
          },
    );
    return changes;
  }
  const p = s.tables.patterns[a.patternId];
  if (!p) throw new Error("Unknown pattern");
  const events = Object.values(s.tables.events)
    .filter((e) => e.patternId === p.id)
    .sort(
      (a, b) =>
        cmp(a.start, b.start) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  if (a.type === "variation") {
    const chordIds = new Map<string, string>();
    for (const e of events)
      if (e.chordId && !chordIds.has(e.chordId)) {
        const id = fresh(`${a.newId}-c${chordIds.size}`);
        chordIds.set(e.chordId, id);
        put("chords", id, { ...s.tables.chords[e.chordId], id });
      }
    put("patterns", a.newId, {
      ...p,
      id: a.newId,
      name: a.name,
      sourceId: p.id,
    });
    events.forEach((e, i) => {
      const id = fresh(`${a.newId}-e${i}`);
      put("events", id, {
        ...e,
        id,
        patternId: a.newId,
        chordId: e.chordId ? chordIds.get(e.chordId)! : null,
      });
    });
  } else if (a.type === "accents") {
    if (!Number.isSafeInteger(a.steps))
      throw new Error("Accent rotation needs whole steps");
    const played = events.filter((e) => e.kind !== "rest");
    const n = played.length;
    played.forEach((e, i) =>
      put("events", e.id, {
        ...e,
        accent: played[(((i - (a.steps % n)) % n) + n) % n]!.accent,
      }),
    );
  } else if (a.type === "rotate") {
    exact(a.amount);
    for (const e of events)
      put("events", e.id, {
        ...e,
        start: modulo(add(e.start, a.amount), p.length),
      });
  } else if (a.type === "scale") {
    exact(a.factor, true);
    if (
      !["scale", "preserve"].includes(a.releases) ||
      !["follow", "keep"].includes(a.phases)
    )
      throw new Error("Choose release and phase policies");
    const scaled = (t: Time) => mul(t, a.factor);
    const release = (t: Time) => (a.releases === "scale" ? scaled(t) : t);
    put("patterns", p.id, {
      ...p,
      length: scaled(p.length),
      groups: p.groups.map(scaled),
    });
    for (const e of events)
      put("events", e.id, {
        ...e,
        start: scaled(e.start),
        duration: release(e.duration),
        performance: e.performance.map((m) => ({
          ...m,
          offset: scaled(m.offset),
          duration: release(m.duration),
        })),
      });
    if (a.phases === "follow")
      for (const o of Object.values(s.tables.occurrences).filter(
        (o) => o.patternId === p.id,
      ))
        put("occurrences", o.id, { ...o, phase: scaled(o.phase) });
  } else if (a.type === "splice") {
    exact(a.at);
    exact(a.amount, true);
    if (
      !["insert", "remove"].includes(a.mode) ||
      !["reject", "delete"].includes(a.attacks) ||
      !["follow", "keep"].includes(a.phases)
    )
      throw new Error("Choose splice policies");
    if (cmp(a.at, ZERO) < 0 || cmp(a.at, p.length) > 0)
      throw new Error("Splice position outside pattern");
    const end = add(a.at, a.amount),
      removing = a.mode === "remove";
    if (removing && cmp(end, p.length) > 0)
      throw new Error("Cut extends past cycle");
    const length = removing ? sub(p.length, a.amount) : add(p.length, a.amount);
    if (cmp(length, ZERO) <= 0) throw new Error("Cycle must remain positive");
    const inside = (t: Time) => cmp(t, a.at) >= 0 && cmp(t, end) < 0;
    const mapped = (t: Time) =>
      cmp(t, a.at) < 0
        ? t
        : !removing
          ? add(t, a.amount)
          : cmp(t, end) >= 0
            ? sub(t, a.amount)
            : a.at;
    let groupStart = ZERO;
    const groups: Time[] = [];
    for (let i = 0; i < p.groups.length; i++) {
      const g = p.groups[i]!,
        groupEnd = add(groupStart, g);
      let next = g;
      if (
        !removing &&
        cmp(a.at, groupStart) >= 0 &&
        (cmp(a.at, groupEnd) < 0 ||
          (i === p.groups.length - 1 && cmp(a.at, groupEnd) === 0))
      )
        next = add(g, a.amount);
      if (removing) {
        const lo = cmp(groupStart, a.at) > 0 ? groupStart : a.at,
          hi = cmp(groupEnd, end) < 0 ? groupEnd : end;
        if (cmp(hi, lo) > 0) next = sub(g, sub(hi, lo));
      }
      if (cmp(next, ZERO) > 0) groups.push(next);
      groupStart = groupEnd;
    }
    put("patterns", p.id, { ...p, length, groups });
    for (const e of events) {
      if (removing && inside(e.start)) {
        if (a.attacks === "reject")
          throw new Error(
            `Cut contains ${e.name}; choose delete attacks or another span`,
          );
        put("events", e.id, null);
        continue;
      }
      const start = mapped(e.start);
      const performance = e.performance.map((m) => {
        const attack = add(e.start, m.offset);
        if (removing && inside(attack))
          throw new Error(
            `Cut contains a chord-member attack in ${e.name}; adjust its performance explicitly`,
          );
        return { ...m, offset: sub(mapped(attack), start) };
      });
      put("events", e.id, { ...e, start, performance });
    }
    if (a.phases === "follow")
      for (const o of Object.values(s.tables.occurrences).filter(
        (o) => o.patternId === p.id,
      ))
        put("occurrences", o.id, {
          ...o,
          phase: modulo(mapped(o.phase), length),
        });
  } else throw new Error("Unknown rhythm action");
  return changes;
}
