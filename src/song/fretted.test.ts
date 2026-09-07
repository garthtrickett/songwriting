import { it, expect } from "bun:test";
import { frettedSong, finger } from "../../tests/fretted.ts";
import { fretPositions, fingeringIssues } from "./fretted.ts";
import { tablature } from "./tablature.ts";
import { validateSong } from "./validate.ts";
import { applyCommand, type Command, type Envelope } from "./commands.ts";
import { hydrateEnvelope } from "./history.ts";
const create = () =>
  applyCommand(
    undefined,
    {
      songId: "fretted-song",
      expectedRevision: 0,
      operationId: "create",
      label: "Create",
      command: { kind: "replace", song: frettedSong() },
    },
    0,
  );
const edit = (e: Envelope, command: Command) =>
  applyCommand(
    e,
    {
      songId: e.id,
      expectedRevision: e.revision,
      operationId: `op-${e.revision}`,
      label: "Edit",
      command,
    },
    0,
  );
it("resolves exact frets in standard, alternate, capo and re-entrant tunings without rewriting notes", () => {
  const s = frettedSong(),
    before = structuredClone(s.tables.events);
  expect(
    fretPositions(s, "drop", "line", "first", null).positions,
  ).toContainEqual({ string: 2, fret: 3, physicalFret: 3 });
  s.tables.fretted.drop!.capo = 2;
  expect(
    fretPositions(s, "drop", "line", "first", null).positions,
  ).toContainEqual({ string: 2, fret: 1, physicalFret: 3 });
  s.tables.fretted.drop!.tuning = [60, 67, 50];
  expect(fretPositions(s, "drop", "line", "first", null).positions[0]).toEqual({
    string: 1,
    fret: 0,
    physicalFret: 2,
  });
  expect(s.tables.events).toEqual(before);
  s.tables.parts.guitar!.instrument = "bass";
  s.tables.fretted.drop!.tuning = [43, 38, 33, 28];
  s.tables.fretted.drop!.capo = 0;
  expect(
    fretPositions(s, "drop", "bass", "held", null).positions,
  ).toContainEqual({ string: 1, fret: 7, physicalFret: 7 });
  s.tables.fretted.drop!.maxFret = 2;
  expect(fretPositions(s, "drop", "line", "first", null).unplayable).toBe(true);
});
it("keeps independent pedal releases and detects string collisions even when notes enter the requested range", () => {
  const s = frettedSong();
  s.tables.fingerings.first = finger("first");
  s.tables.fingerings.held = finger("held", "held", {
    occurrenceId: "bass",
    string: 2,
    fret: 0,
    technique: "let-ring",
  });
  const t = tablature(s, "drop", [1, 4], [1, 1]);
  expect(t.rows.find((n) => n.eventId === "held")!.duration).toEqual([8, 1]);
  expect(
    t.rows
      .find((n) => n.eventId === "first")!
      .issues.some((x) => x.includes("collision")),
  ).toBe(true);
  expect(t.rows.find((n) => n.eventId === "second")!.issues).toContain(
    "Unassigned note",
  );
});
it("connected techniques check direction, voice and actual predecessor without modifying musical sustain", () => {
  const s = frettedSong();
  s.tables.fingerings.first = finger("first");
  s.tables.fingerings.second = finger("second", "second", {
    fret: 5,
    technique: "hammer-on",
    fromId: "first",
  });
  let t = tablature(s, "drop", [0, 1], [8, 1]);
  expect(
    t.rows.filter((n) => n.fingering).every((n) => n.issues.length === 0),
  ).toBe(true);
  expect(t.rows[0]!.duration).toEqual([2, 1]);
  s.tables.fingerings.second!.technique = "pull-off";
  expect(fingeringIssues(s, s.tables.fingerings.second!)[0]).toContain(
    "direction",
  );
  s.tables.fingerings.second!.technique = "slide";
  s.tables.events.first!.duration = [1, 4];
  t = tablature(s, "drop", [0, 1], [8, 1]);
  expect(
    t.rows
      .find((n) => n.eventId === "second")!
      .issues.some((i) => i.includes("preceding")),
  ).toBe(true);
});
it("reports stale positions after transposition, tuning and musical deletion instead of restricting composition", () => {
  let e = create();
  const f = finger("first");
  e = edit(e, {
    kind: "edit",
    changes: [{ table: "fingerings", id: f.id, value: f }],
  });
  const source = structuredClone(e.song!.tables.events.held);
  e = edit(e, {
    kind: "harmony",
    action: {
      type: "transpose",
      patternId: "riff",
      newId: "up",
      steps: 1,
      semitones: 2,
    },
  });
  expect(fingeringIssues(e.song!, f)[0]).toContain("current note");
  expect(e.song!.tables.events.held).toEqual(source);
  e = edit(e, {
    kind: "edit",
    changes: [{ table: "events", id: "first", value: null }],
  });
  expect(
    tablature(e.song!, "drop", [0, 1], [8, 1]).stale[0]!.issues[0],
  ).toContain("Stale");
  expect(validateSong(e.song).ok).toBe(true);
});
it("a section variation relinks local fingerings and technique sources while global pedal assignments stay fixed", () => {
  let e = create();
  const a = finger("first"),
    b = finger("second", "second", {
      fret: 5,
      technique: "hammer-on",
      fromId: "first",
    }),
    held = finger("held", "held", { occurrenceId: "bass", string: 4, fret: 0 });
  e = edit(e, {
    kind: "edit",
    changes: [a, b, held].map((value) => ({
      table: "fingerings",
      id: value.id,
      value,
    })),
  });
  e = edit(e, {
    kind: "structure",
    action: {
      type: "variation",
      appearanceId: "a",
      newId: "answer",
      name: "Answer",
    },
  });
  const copies = Object.values(e.song!.tables.fingerings).filter((f) =>
    f.id.startsWith("answer"),
  );
  expect(copies).toHaveLength(2);
  expect(copies.find((f) => f.technique === "hammer-on")!.fromId).toBe(
    copies.find((f) => f.technique === "tap")!.id,
  );
  expect(e.song!.tables.fingerings.held).toEqual(held);
  expect(
    tablature(e.song!, "drop", [0, 1], [8, 1]).rows.every(
      (n) => n.issues.length === 0,
    ),
  ).toBe(true);
});
it("migrates schema 4 history and retains fingerprint, retries and undo semantics", () => {
  const legacy = structuredClone(create()) as any;
  legacy.song.schemaVersion = 4;
  delete legacy.song.tables.fretted;
  delete legacy.song.tables.fingerings;
  legacy.history[0].deltas = legacy.history[0].deltas.filter(
    (d: any) => !["fretted", "fingerings"].includes(d.table),
  );
  const e = hydrateEnvelope(legacy);
  expect(e.song!.schemaVersion).toBe(7);
  expect(e.song!.tables.fretted).toEqual({});
  expect(e.history[0]!.fingerprint).toBe(legacy.history[0].fingerprint);
  const empty = edit(e, { kind: "undo", targetId: "create" });
  expect(empty.song).toBeNull();
  expect(
    edit(empty, { kind: "undo", targetId: empty.history.at(-1)!.operationId })
      .song!.tables.events,
  ).toEqual(e.song!.tables.events);
});
it("checks shape and unique targets while preserving wrong musical positions for review", () => {
  const s = frettedSong();
  s.tables.fingerings.a = finger("a", "first", { fret: 36 });
  expect(validateSong(s).ok).toBe(true);
  expect(fingeringIssues(s, s.tables.fingerings.a).length).toBeGreaterThan(0);
  s.tables.fingerings.b = finger("b");
  expect(validateSong(s).ok).toBe(false);
  delete s.tables.fingerings.b;
  s.tables.fretted.drop!.tuning = [];
  expect(validateSong(s).ok).toBe(false);
});
it("tab preserves member attacks and reports display bounds and hand-span warnings", () => {
  const s = frettedSong();
  s.tables.chords.c = {
    id: "c",
    name: "Chord",
    label: null,
    labelTonic: { degree: 1, alteration: 0, octave: 0 },
    notes: [
      { id: "one", pitch: { degree: 1, alteration: 0, octave: 1 } },
      { id: "two", pitch: { degree: 2, alteration: 0, octave: 1 } },
    ],
  };
  Object.assign(s.tables.events.first!, {
    kind: "chord",
    chordId: "c",
    performance: [{ memberId: "two", offset: [1, 3], duration: [1, 1] }],
  });
  s.tables.fingerings.one = finger("one", "first", {
    memberId: "one",
    string: 2,
    fret: 3,
    technique: "pluck",
  });
  s.tables.fingerings.two = finger("two", "first", {
    memberId: "two",
    string: 3,
    fret: 9,
    technique: "pluck",
  });
  let t = tablature(s, "drop", [0, 1], [8, 1]);
  expect(t.rows.find((n) => n.memberId === "two")!.start).toEqual([1, 3]);
  expect(t.rows.find((n) => n.memberId === "one")!.issues).toContain(
    "Preferred hand span exceeded",
  );
  s.tables.occurrences.line!.sectionId = null;
  s.tables.occurrences.line!.span = [800, 1];
  t = tablature(s, "drop", [0, 1], [800, 1]);
  expect(t.total).toBe(601);
  expect(t.rows).toHaveLength(512);
  expect(t.truncated).toBe(true);
  expect(() => tablature(s, "drop", [1, 1], [0, 1])).toThrow();
});
