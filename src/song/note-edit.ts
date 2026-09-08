import type { Change } from "./commands.ts";
import {
  noteEvent,
  type Song,
  type Pitch,
  type MusicalEvent,
} from "./model.ts";
import { add, sub, mul, cmp, time, ZERO, type Time } from "./time.ts";

export interface NoteTarget {
  eventId: string;
  memberId: string | null;
}
export interface EditableNote extends NoteTarget {
  pitch: Pitch;
  start: Time;
  duration: Time;
}
export const noteKey = (n: NoteTarget) => `${n.eventId}/${n.memberId ?? ""}`;

export function editableNotes(s: Song, patternId: string): EditableNote[] {
  return Object.values(s.tables.events)
    .filter((e) => e.patternId === patternId)
    .flatMap<EditableNote>((e) => {
      if (e.kind === "note")
        return [
          {
            eventId: e.id,
            memberId: null,
            pitch: e.pitch,
            start: e.start,
            duration: e.duration,
          },
        ];
      if (e.kind !== "chord") return [];
      return s.tables.chords[e.chordId!]!.notes.map((n) => {
        const p = e.performance.find((p) => p.memberId === n.id);
        return {
          eventId: e.id,
          memberId: n.id,
          pitch: n.pitch,
          start: add(e.start, p?.offset ?? ZERO),
          duration: p?.duration ?? e.duration,
        };
      });
    });
}

// Pointer coordinates are first converted to a bounded rational. All musical
// snapping after that is exact, including thirds, sevenths and negative deltas.
export function snapTime(at: Time, step: Time): Time {
  if (cmp(step, ZERO) <= 0) throw new Error("Snap must be positive");
  const n = BigInt(at[0]) * BigInt(step[1]),
    d = BigInt(at[1]) * BigInt(step[0]);
  const sign = n < 0n ? -1n : 1n,
    abs = n * sign;
  const count = sign * ((abs + d / 2n) / d);
  return mul(time(Number(count)), step);
}
export const shiftDegree = (p: Pitch, steps: number): Pitch => {
  const index = p.octave * 7 + p.degree - 1 + steps;
  return {
    ...p,
    degree: (((index % 7) + 7) % 7) + 1,
    octave: Math.floor(index / 7),
  };
};

export function changeNotes(
  s: Song,
  edits: (NoteTarget & { pitch?: Pitch; start?: Time; duration?: Time })[],
): Change[] {
  const events = new Map<string, MusicalEvent>();
  const chords = new Map<string, Song["tables"]["chords"][string]>();
  for (const edit of edits) {
    const original = s.tables.events[edit.eventId];
    if (!original) throw new Error("The selected note no longer exists");
    const e = events.get(original.id) ?? structuredClone(original);
    if (edit.memberId === null) {
      if (e.kind !== "note")
        throw new Error("Select an individual pitched note");
      if (edit.pitch) e.pitch = edit.pitch;
      if (edit.start) e.start = edit.start;
      if (edit.duration) e.duration = edit.duration;
    } else {
      if (e.kind !== "chord") throw new Error("The selected chord changed");
      const chord =
        chords.get(e.chordId!) ?? structuredClone(s.tables.chords[e.chordId!]!);
      const member = chord.notes.find((n) => n.id === edit.memberId);
      if (!member) throw new Error("The chord member no longer exists");
      if (edit.pitch) {
        member.pitch = edit.pitch;
        chords.set(chord.id, chord);
      }
      if (edit.start || edit.duration) {
        let performance = e.performance.find(
          (p) => p.memberId === edit.memberId,
        );
        if (!performance) {
          performance = {
            memberId: edit.memberId,
            offset: ZERO,
            duration: e.duration,
          };
          e.performance.push(performance);
        }
        if (edit.start) performance.offset = sub(edit.start, e.start);
        if (edit.duration) performance.duration = edit.duration;
        // Moving one member earlier moves the event anchor and preserves every
        // other member's absolute attack and release, including implicit defaults.
        if (cmp(performance.offset, ZERO) < 0) {
          const shift = performance.offset;
          for (const member of chord.notes) {
            if (!e.performance.some((p) => p.memberId === member.id))
              e.performance.push({
                memberId: member.id,
                offset: ZERO,
                duration: e.duration,
              });
          }
          e.start = add(e.start, shift);
          e.performance = e.performance.map((p) => ({
            ...p,
            offset: sub(p.offset, shift),
          }));
        }
      }
    }
    events.set(e.id, e);
  }
  return [...events]
    .map(([id, value]): Change => ({ table: "events", id, value }))
    .concat(
      [...chords].map(
        ([id, value]): Change => ({ table: "chords", id, value }),
      ),
    );
}

export function removeNotes(s: Song, targets: NoteTarget[]): Change[] {
  const removals = new Map<string, Set<string>>(),
    deleted = new Set<string>();
  for (const t of targets) {
    const e = s.tables.events[t.eventId];
    if (!e) throw new Error("The selected event no longer exists");
    if (t.memberId === null) deleted.add(e.id);
    else {
      const ids = removals.get(e.chordId!) ?? new Set<string>();
      ids.add(t.memberId);
      removals.set(e.chordId!, ids);
    }
  }
  const changes: Change[] = [...deleted].map((id) => ({
    table: "events",
    id,
    value: null,
  }));
  for (const [id, members] of removals) {
    const chord = s.tables.chords[id]!;
    const notes = chord.notes.filter((n) => !members.has(n.id));
    if (!notes.length)
      throw new Error(
        "A chord needs at least one member. Delete the chord event in Selection instead.",
      );
    changes.push({ table: "chords", id, value: { ...chord, notes } });
    for (const e of Object.values(s.tables.events).filter(
      (e) => e.chordId === id && !deleted.has(e.id),
    ))
      changes.push({
        table: "events",
        id: e.id,
        value: {
          ...e,
          performance: e.performance.filter((p) => !members.has(p.memberId)),
        },
      });
  }
  return changes;
}

export function combineNotes(
  s: Song,
  targets: NoteTarget[],
  chordId: string,
  eventId: string,
): Change[] {
  if (!targets.length || targets.some((t) => t.memberId !== null))
    throw new Error("Select individual notes to make a chord");
  const events = [...new Set(targets.map((t) => t.eventId))].map(
    (id) => s.tables.events[id]!,
  );
  if (
    events.some(
      (e) => !e || e.kind !== "note" || e.patternId !== events[0]!.patternId,
    )
  )
    throw new Error("Choose notes from one pattern");
  if (
    events.some(
      (e) =>
        e.accent !== events[0]!.accent ||
        e.articulation !== events[0]!.articulation,
    )
  )
    throw new Error(
      "Choose notes with matching expression, or use Harmony to set member expression explicitly",
    );
  const start = events.reduce(
    (a, e) => (cmp(e.start, a) < 0 ? e.start : a),
    events[0]!.start,
  );
  const end = events.reduce(
    (a, e) =>
      cmp(add(e.start, e.duration), a) > 0 ? add(e.start, e.duration) : a,
    start,
  );
  const event = {
    ...noteEvent(eventId, events[0]!.patternId),
    kind: "chord" as const,
    name: "Chord",
    chordId,
    start,
    duration: sub(end, start),
    accent: events[0]!.accent,
    articulation: events[0]!.articulation,
    performance: events.map((e) => ({
      memberId: e.id,
      offset: sub(e.start, start),
      duration: e.duration,
    })),
  };
  return [
    {
      table: "chords",
      id: chordId,
      value: {
        id: chordId,
        name: "Chord",
        label: null,
        labelTonic: { degree: 1, alteration: 0, octave: 0 },
        notes: events.map((e) => ({ id: e.id, pitch: e.pitch })),
      },
    },
    { table: "events", id: eventId, value: event },
    ...events.map((e): Change => ({ table: "events", id: e.id, value: null })),
  ];
}
