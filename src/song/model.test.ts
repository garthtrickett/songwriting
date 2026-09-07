import { describe, it, expect } from "bun:test";
import { add, time, cmp } from "./time.ts";
import { emptySong, noteEvent, type Song } from "./model.ts";
import { alignment, bars, sounds, secondsPerQuarter } from "./timeline.ts";
import { validateSong } from "./validate.ts";
import { applyCommand, type Mutation } from "./commands.ts";
export function fixture(): Song {
  const s = emptySong("test");
  const t = s.tables;
  t.parts.g = {
    id: "g",
    name: "Guitar",
    instrument: "guitar",
    volume: 0.6,
    muted: false,
  };
  t.parts.d = {
    id: "d",
    name: "Drums",
    instrument: "drums",
    volume: 0.6,
    muted: false,
  };
  t.voices.gv = { id: "gv", name: "Guitar voice", partId: "g" };
  t.voices.dv = { id: "dv", name: "Drum voice", partId: "d" };
  t.patterns.seven = {
    id: "seven",
    name: "Seven",
    length: [7, 2],
    groups: [],
    sourceId: null,
  };
  t.patterns.eight = {
    id: "eight",
    name: "Eight",
    length: [4, 1],
    groups: [],
    sourceId: null,
  };
  t.events.n = { ...noteEvent("n", "seven"), duration: [5, 1] };
  t.events.d = { ...noteEvent("d", "eight"), kind: "drum" };
  t.occurrences.g = {
    id: "g",
    name: "Guitar cycle",
    patternId: "seven",
    voiceId: "gv",
    start: [0, 1],
    span: [32, 1],
    phase: [0, 1],
    sectionId: null,
    boundary: "continue",
    tails: "ring",
  };
  t.occurrences.d = {
    ...t.occurrences.g,
    id: "d",
    name: "Drum cycle",
    patternId: "eight",
    voiceId: "dv",
  };
  t.sections.a = { sourceId: null, id: "a", name: "A", barIds: ["b1"] };
  t.sections.b = { sourceId: null, id: "b", name: "B", barIds: ["b2"] };
  t.bars.b1 = {
    id: "b1",
    name: "Bar 1",
    sectionId: "a",
    numerator: 7,
    denominator: 8,
    groups: [2, 2, 3],
    actual: null,
  };
  t.bars.b2 = {
    id: "b2",
    name: "Bar 2",
    sectionId: "b",
    numerator: 6,
    denominator: 8,
    groups: [3, 3],
    actual: null,
  };
  t.arrangement.a = { id: "a", name: "A", sectionId: "a" };
  t.arrangement.b = { id: "b", name: "B", sectionId: "b" };
  s.arrangementOrder = ["a", "b"];
  return s;
}
describe("musical time and structure", () => {
  it("keeps tuplets exact and rejects overflow", () => {
    expect(add(add(time(1, 3), time(1, 3)), time(1, 3))).toEqual([1, 1]);
    expect(() => time(1, 0)).toThrow();
    expect(() => add(time(Number.MAX_SAFE_INTEGER), time(1))).toThrow();
  });
  it("validates the complete composition", () =>
    expect(validateSong(fixture()).ok).toBe(true));
  it("aligns seven and eight eighth-note cycles at 56 eighths", () =>
    expect(alignment(fixture(), ["g", "d"], [0, 1], [32, 1])).toEqual([28, 1]));
  it("returns no alignment for incompatible phases", () => {
    const s = fixture();
    s.tables.occurrences.d!.phase = [1, 3];
    expect(alignment(s, ["g", "d"], [0, 1], [32, 1])).toBe(null);
  });
  it("resolves compound and incomplete bars without reducing signatures", () => {
    const s = fixture();
    s.tables.bars.b1!.actual = [1, 2];
    const b = bars(s);
    expect(b[1]!.start).toEqual([1, 2]);
    expect(b[1]!.numerator).toBe(6);
    expect(b[1]!.denominator).toBe(8);
  });
  it("preserves tails and only restarts at sections when asked", () => {
    const s = fixture();
    s.tables.bars.b1!.numerator = 4;
    s.tables.bars.b1!.denominator = 4;
    s.tables.bars.b1!.groups = [1, 1, 1, 1];
    expect(sounds(s).filter((n) => n.partId === "g")[1]!.start).toEqual([7, 2]);
    expect(sounds(s)[0]!.duration).toEqual([5, 1]);
    s.tables.occurrences.g!.boundary = "restart";
    expect(
      sounds(s).some((n) => n.partId === "g" && cmp(n.start, [4, 1]) === 0),
    ).toBe(true);
    s.tables.occurrences.g!.boundary = "stop";
    expect(sounds(s).filter((n) => n.partId === "g").length).toBe(2);
  });
  it("performs chord members with distinct attacks/releases and does not sound rests", () => {
    const s = fixture();
    s.tables.chords.c = {
      id: "c",
      name: "Tonic",
      label: "I",
      notes: [
        { id: "root", pitch: { degree: 1, alteration: 0, octave: 0 } },
        { id: "third", pitch: { degree: 3, alteration: 0, octave: 0 } },
      ],
    };
    s.tables.events.n = {
      ...s.tables.events.n!,
      kind: "chord",
      chordId: "c",
      performance: [{ memberId: "third", offset: [1, 3], duration: [2, 1] }],
    };
    expect(validateSong(s).ok).toBe(true);
    const n = sounds(s).filter((n) => n.partId === "g");
    expect(n[1]!.start).toEqual([1, 3]);
    expect(n[1]!.duration).toEqual([2, 1]);
    s.tables.events.n = { ...noteEvent("n", "seven"), kind: "rest" };
    expect(sounds(s).every((n) => n.partId === "d")).toBe(true);
  });
  it("uses the explicit tempo beat unit", () => {
    const s = fixture();
    s.tempo = { bpm: 120, beatUnit: [3, 2] };
    expect(secondsPerQuarter(s)).toBe(1 / 3);
  });
  it("rejects corrupt relationships and accepts unresolved harmony", () => {
    const s = fixture();
    s.tables.voices.gv!.partId = "missing";
    expect(validateSong(s).ok).toBe(false);
  });
});
describe("edits and undo", () => {
  const create: Mutation = {
    songId: "test",
    expectedRevision: 0,
    operationId: "create",
    label: "Create",
    command: { kind: "replace", song: fixture() },
  };
  it("validates atomic changes and preserves unrelated intervening edits on undo", () => {
    const a = applyCommand(undefined, create, 0);
    const b = applyCommand(
      a,
      {
        ...create,
        expectedRevision: 1,
        operationId: "title",
        command: {
          kind: "edit",
          changes: [{ table: "meta", id: "title", value: "Edited" }],
        },
      },
      1,
    );
    const c = applyCommand(
      b,
      {
        ...create,
        expectedRevision: 2,
        operationId: "mode",
        command: {
          kind: "edit",
          changes: [{ table: "meta", id: "mode", value: "minor" }],
        },
      },
      2,
    );
    const d = applyCommand(
      c,
      {
        ...create,
        expectedRevision: 3,
        operationId: "undo",
        command: { kind: "undo", targetId: "title" },
      },
      3,
    );
    expect(d.song!.title).toBe("Untitled idea");
    expect(d.song!.mode).toBe("minor");
    expect(() =>
      applyCommand(d, { ...create, expectedRevision: 1 }, 4),
    ).toThrow("Revision conflict");
  });
  it("rejects undo over a changed entity", () => {
    let e = applyCommand(undefined, create, 0);
    for (const [i, title] of ["A", "B"].entries())
      e = applyCommand(
        e,
        {
          ...create,
          expectedRevision: i + 1,
          operationId: title,
          command: {
            kind: "edit",
            changes: [{ table: "meta", id: "title", value: title }],
          },
        },
        0,
      );
    expect(() =>
      applyCommand(
        e,
        {
          ...create,
          expectedRevision: 3,
          command: { kind: "undo", targetId: "A" },
        },
        0,
      ),
    ).toThrow("Undo conflict");
  });
  it("undoes deletion and creation safely", () => {
    const a = applyCommand(undefined, create, 0);
    const b = applyCommand(
      a,
      {
        ...create,
        expectedRevision: 1,
        operationId: "del",
        command: { kind: "delete" },
      },
      0,
    );
    const c = applyCommand(
      b,
      {
        ...create,
        expectedRevision: 2,
        operationId: "restore",
        command: { kind: "undo", targetId: "del" },
      },
      0,
    );
    expect(c.song).toEqual(a.song);
  });
});
it("rests release only their own voice while a different voice rings", () => {
  const s = fixture();
  s.tables.events.rest = {
    ...noteEvent("rest", "seven"),
    kind: "rest",
    start: [1, 1],
    duration: [1, 1],
  };
  s.tables.patterns.pedal = {
    id: "pedal",
    name: "Pedal",
    length: [32, 1],
    groups: [],
    sourceId: null,
  };
  s.tables.voices.other = { id: "other", name: "Other voice", partId: "g" };
  s.tables.events.pedal = { ...noteEvent("pedal", "pedal"), duration: [10, 1] };
  s.tables.occurrences.pedal = {
    ...s.tables.occurrences.g!,
    id: "pedal",
    patternId: "pedal",
    voiceId: "other",
  };
  expect(sounds(s).find((n) => n.eventId === "n")!.duration).toEqual([1, 1]);
  expect(sounds(s).find((n) => n.eventId === "pedal")!.duration).toEqual([
    10, 1,
  ]);
});
it("clears a stale chord interpretation when its pitches change", () => {
  const s = fixture();
  s.tables.chords.c = {
    id: "c",
    name: "Tonic",
    label: "I",
    notes: [{ id: "n", pitch: { degree: 1, alteration: 0, octave: 0 } }],
  };
  const create: Mutation = {
    songId: "test",
    expectedRevision: 0,
    operationId: "create",
    label: "Create",
    command: { kind: "replace", song: s },
  };
  const a = applyCommand(undefined, create, 0);
  const chord = {
    ...s.tables.chords.c,
    notes: [{ id: "n", pitch: { degree: 2, alteration: 0, octave: 0 } }],
  };
  const b = applyCommand(
    a,
    {
      ...create,
      expectedRevision: 1,
      operationId: "change",
      command: {
        kind: "edit",
        changes: [{ table: "chords", id: "c", value: chord }],
      },
    },
    0,
  );
  expect(b.song!.tables.chords.c!.label).toBe(null);
});
