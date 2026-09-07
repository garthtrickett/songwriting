import { type Song, type Articulation } from "./model.ts";
import { type Change } from "./commands.ts";
import { buildChord, type ChordRecipe } from "./chord-builder.ts";
import { shiftPitch } from "./harmony-pitch.ts";
import { voiceLeading } from "./voice-leading.ts";
import { mul, cmp, time, ZERO, type Time } from "./time.ts";
export type HarmonyAction =
  | {
      type: "build";
      newId: string;
      name: string;
      recipe: ChordRecipe;
      eventId: string | null;
      performance: "reset" | "reject";
    }
  | {
      type: "transpose";
      patternId: string;
      newId: string;
      steps: number;
      semitones: number;
    }
  | {
      type: "voiceLead";
      sourceId: string;
      targetId: string;
      octaveRadius: number;
    }
  | {
      type: "perform";
      eventId: string;
      order: string[];
      step: Time;
      duration: Time | null;
    }
  | {
      type: "expression";
      eventIds: string[];
      from: number;
      to: number;
      articulation: Articulation;
      gate: Time;
    };
function exact(t: Time, positive = false) {
  if (
    !Array.isArray(t) ||
    t.length !== 2 ||
    time(t[0], t[1]).join() !== t.join() ||
    cmp(t, ZERO) < (positive ? 1 : 0)
  )
    throw new Error(
      "Use normalized nonnegative time; duration must be positive",
    );
}
export function harmonyChanges(s: Song, a: HarmonyAction): Change[] {
  const changes: Change[] = [];
  const fresh = (id: string, limit = 100) => {
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
      id.length > limit ||
      ["__proto__", "constructor", "prototype"].includes(id) ||
      Object.values(s.tables).some((t) => Object.hasOwn(t, id))
    )
      throw new Error("Choose a new unique ID within supported length");
  };
  if (a.type === "build") {
    fresh(a.newId, 70);
    if (!["reset", "reject"].includes(a.performance))
      throw new Error("Choose member performance handling");
    const chord = buildChord(a.newId, a.name, a.recipe);
    changes.push({ table: "chords", id: chord.id, value: chord });
    if (a.eventId !== null) {
      const e = s.tables.events[a.eventId];
      if (!e || e.kind !== "chord") throw new Error("Choose a chord event");
      if (e.performance.length && a.performance === "reject")
        throw new Error(
          "Event has member performance; explicitly reset it before replacing the chord",
        );
      changes.push({
        table: "events",
        id: e.id,
        value: { ...e, chordId: chord.id, performance: [] },
      });
    }
  } else if (a.type === "transpose") {
    if (!Number.isSafeInteger(a.steps) || !Number.isSafeInteger(a.semitones))
      throw new Error("Intervals require integer steps and semitones");
    fresh(a.newId, 70);
    if (!s.tables.patterns[a.patternId]) throw new Error("Unknown pattern");
    const events = Object.values(s.tables.events).filter(
        (e) => e.patternId === a.patternId,
      ),
      copied = new Map<string, string>();
    for (const e of events) {
      if (e.kind === "note")
        changes.push({
          table: "events",
          id: e.id,
          value: { ...e, pitch: shiftPitch(e.pitch, a.steps, a.semitones) },
        });
      if (e.kind === "chord") {
        let id = copied.get(e.chordId!);
        if (!id) {
          id = `${a.newId}-${copied.size}`;
          fresh(id);
          copied.set(e.chordId!, id);
          const c = s.tables.chords[e.chordId!]!;
          changes.push({
            table: "chords",
            id,
            value: {
              ...c,
              id,
              label: null,
              notes: c.notes.map((n) => ({
                ...n,
                pitch: shiftPitch(n.pitch, a.steps, a.semitones),
              })),
            },
          });
        }
        changes.push({
          table: "events",
          id: e.id,
          value: { ...e, chordId: id },
        });
      }
    }
  } else if (a.type === "voiceLead") {
    const result = voiceLeading(s, a.sourceId, a.targetId, a.octaveRadius);
    changes.push({
      table: "chords",
      id: a.targetId,
      value: { ...s.tables.chords[a.targetId], notes: result.notes },
    });
  } else if (a.type === "perform") {
    exact(a.step);
    if (a.duration !== null) exact(a.duration, true);
    const e = s.tables.events[a.eventId];
    if (!e || e.kind !== "chord") throw new Error("Choose a chord event");
    const notes = s.tables.chords[e.chordId!]!.notes;
    if (
      !Array.isArray(a.order) ||
      a.order.length !== notes.length ||
      new Set(a.order).size !== notes.length ||
      !a.order.every((id) => notes.some((n) => n.id === id))
    )
      throw new Error("Order must contain every chord member exactly once");
    changes.push({
      table: "events",
      id: e.id,
      value: {
        ...e,
        performance: a.order.map((memberId, i) => {
          const prior = e.performance.find((m) => m.memberId === memberId);
          return {
            ...prior,
            memberId,
            offset: mul(a.step, [i, 1]),
            duration: a.duration ?? prior?.duration ?? e.duration,
          };
        }),
      },
    });
  } else if (a.type === "expression") {
    exact(a.gate, true);
    if (
      !Array.isArray(a.eventIds) ||
      !a.eventIds.length ||
      a.eventIds.length > 512 ||
      new Set(a.eventIds).size !== a.eventIds.length ||
      ![a.from, a.to].every((x) => Number.isFinite(x) && x >= 0 && x <= 1) ||
      !["normal", "staccato", "sustain", "muted", "ghost"].includes(
        a.articulation,
      )
    )
      throw new Error("Choose 1–512 events, accents 0–1 and articulation");
    const events = a.eventIds
      .map((id) => {
        const e = s.tables.events[id];
        if (!e || e.kind === "rest")
          throw new Error("Select sounding events; rests stay independent");
        return e;
      })
      .sort((a, b) => cmp(a.start, b.start) || (a.id < b.id ? -1 : 1));
    if (new Set(events.map((e) => e.patternId)).size !== 1)
      throw new Error("Choose expression events from one pattern");
    events.forEach((e, i) =>
      changes.push({
        table: "events",
        id: e.id,
        value: {
          ...e,
          accent:
            a.from +
            (a.to - a.from) *
              (events.length === 1 ? 0 : i / (events.length - 1)),
          articulation: a.articulation,
          duration: mul(e.duration, a.gate),
          performance: e.performance.map((m) => ({
            ...m,
            duration: mul(m.duration, a.gate),
          })),
        },
      }),
    );
  } else throw new Error("Unknown harmony action");
  return changes;
}
