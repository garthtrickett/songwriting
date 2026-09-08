import { test, expect } from "bun:test";
import { acceptance } from "../../tests/acceptance.ts";
import { applyCommand, type Change, type Envelope } from "./commands.ts";
import { noteEvent } from "./model.ts";
import {
  editableNotes,
  changeNotes,
  removeNotes,
  combineNotes,
  snapTime,
  shiftDegree,
} from "./note-edit.ts";
import { sounds } from "./timeline.ts";
const create = () => {
  const song = acceptance();
  return applyCommand(
    undefined,
    {
      songId: song.id,
      expectedRevision: 0,
      operationId: "create",
      label: "Create",
      command: { kind: "replace", song },
    },
    0,
  );
};
const edit = (e: Envelope, changes: Change[]) =>
  applyCommand(
    e,
    {
      songId: e.id,
      expectedRevision: e.revision,
      operationId: `edit-${e.revision}`,
      label: "Edit",
      command: { kind: "edit", changes },
    },
    1,
  );

test("degree gestures snap thirds and sevenths exactly and preserve alterations across octave boundaries", () => {
  expect(snapTime([332, 1000], [1, 3])).toEqual([1, 3]);
  expect(snapTime([-142, 1000], [1, 7])).toEqual([-1, 7]);
  expect(shiftDegree({ degree: 7, alteration: -1, octave: 0 }, 1)).toEqual({
    degree: 1,
    alteration: -1,
    octave: 1,
  });
  expect(shiftDegree({ degree: 1, alteration: 1, octave: 0 }, -1)).toEqual({
    degree: 7,
    alteration: 1,
    octave: -1,
  });
});
test("moving and resizing one chord member preserves siblings, shared IDs and independent voices", () => {
  const e = create(),
    s = e.song!;
  const chord = s.tables.events.chord!;
  const members = editableNotes(s, chord.patternId).filter(
    (n) => n.eventId === chord.id,
  );
  const chosen = members[0]!,
    other = members.slice(1);
  const after = edit(
    e,
    changeNotes(s, [
      {
        ...chosen,
        start: [1, 7],
        duration: [5, 3],
        pitch: { degree: 2, alteration: -1, octave: 1 },
      },
    ]),
  );
  const result = editableNotes(after.song!, chord.patternId).filter(
    (n) => n.eventId === chord.id,
  );
  expect(result.find((n) => n.memberId === chosen.memberId)).toMatchObject({
    start: [1, 7],
    duration: [5, 3],
    pitch: { degree: 2, alteration: -1, octave: 1 },
  });
  expect(result.filter((n) => n.memberId !== chosen.memberId)).toEqual(other);
  expect(after.song!.tables.events.pedal).toEqual(s.tables.events.pedal);
  const undo = applyCommand(
    after,
    {
      songId: e.id,
      expectedRevision: after.revision,
      operationId: "undo",
      label: "Undo",
      command: { kind: "undo", targetId: "edit-1" },
    },
    2,
  );
  expect(undo.song).toEqual(s);
});
test("moving an already staggered member earlier preserves all other absolute attacks and releases", () => {
  let e = create();
  const s = e.song!,
    original = s.tables.events.chord!;
  e = edit(e, [
    {
      table: "events",
      id: original.id,
      value: { ...original, start: [1, 1], performance: [] },
    },
  ]);
  const notes = editableNotes(e.song!, original.patternId).filter(
    (n) => n.eventId === original.id,
  );
  const after = edit(
    e,
    changeNotes(e.song!, [{ ...notes[0]!, start: [1, 3] }]),
  );
  const actual = editableNotes(after.song!, original.patternId).filter(
    (n) => n.eventId === original.id,
  );
  expect(actual[0]!.start).toEqual([1, 3]);
  expect(actual.slice(1)).toEqual(notes.slice(1));
});
test("member deletion removes linked performances, rejects empty chords and keeps source music on invalid edits", () => {
  const e = create(),
    s = e.song!,
    notes = editableNotes(s, "seven").filter((n) => n.eventId === "chord");
  const after = edit(e, removeNotes(s, [notes[0]!]));
  expect(after.song!.tables.chords.tonic!.notes).toHaveLength(2);
  expect(
    after.song!.tables.events.chord!.performance.some(
      (p) => p.memberId === notes[0]!.memberId,
    ),
  ).toBe(false);
  expect(() => removeNotes(s, notes)).toThrow("at least one");
  expect(() =>
    edit(e, changeNotes(s, [{ ...notes[0]!, duration: [-1, 1] }])),
  ).toThrow();
  expect(e.song).toEqual(s);
});
test("explicit chord creation preserves independent timing and sound while one undo restores original notes", () => {
  let e = create();
  const a = {
    ...noteEvent("a", "seven"),
    start: [1, 3] as const,
    duration: [2, 3] as const,
  };
  const b = {
    ...noteEvent("b", "seven"),
    start: [2, 3] as const,
    duration: [5, 3] as const,
    pitch: { degree: 3, alteration: -1, octave: 1 },
  };
  e = edit(e, [
    { table: "events", id: a.id, value: a },
    { table: "events", id: b.id, value: b },
  ]);
  const before = sounds(e.song!)
    .filter((n) => ["a", "b"].includes(n.eventId))
    .map((n) => ({
      start: n.start,
      duration: n.duration,
      pitch: n.pitch,
      gain: n.gain,
    }));
  const after = edit(
    e,
    combineNotes(
      e.song!,
      [
        { eventId: "a", memberId: null },
        { eventId: "b", memberId: null },
      ],
      "new-chord",
      "new-event",
    ),
  );
  expect(
    sounds(after.song!)
      .filter((n) => n.eventId === "new-event")
      .map((n) => ({
        start: n.start,
        duration: n.duration,
        pitch: n.pitch,
        gain: n.gain,
      })),
  ).toEqual(before);
  expect(
    after.song!.tables.chords["new-chord"]!.notes.map((n) => n.id),
  ).toEqual(["a", "b"]);
  const undone = applyCommand(
    after,
    {
      songId: after.id,
      expectedRevision: after.revision,
      operationId: "undo-combined",
      label: "Undo chord grouping",
      command: { kind: "undo", targetId: `edit-${e.revision}` },
    },
    3,
  );
  expect(undone.song).toEqual(e.song);
});
