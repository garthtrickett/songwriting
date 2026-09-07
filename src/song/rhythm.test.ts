import { it, expect } from "bun:test";
import { acceptance } from "../../tests/acceptance.ts";
import { arrangementSong } from "../../tests/arrangement.ts";
import {
  applyCommand,
  previewCommand,
  type Command,
  type Envelope,
} from "./commands.ts";
import {
  alignmentMap,
  polyrhythmGrid,
  comparePatterns,
} from "./rhythm-analysis.ts";
import { type RhythmAction } from "./rhythm.ts";
import { validateSong } from "./validate.ts";
import { sounds } from "./timeline.ts";
import { hydrateEnvelope } from "./history.ts";
const create = (song = acceptance()) =>
  applyCommand(
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
    1,
  );
const rhythm = (e: Envelope, action: RhythmAction) =>
  edit(e, { kind: "rhythm", action });
export const poly = (newId = "poly", counts = [3, 2]): RhythmAction => ({
  type: "polyrhythm",
  newId,
  name: "Cross pulse",
  sectionId: null,
  start: [0, 1],
  duration: [4, 1],
  noteDuration: [1, 4],
  lanes: counts.map((divisions, i) => ({
    voiceId: i === 0 ? "high" : "drums",
    divisions,
    pitch: { degree: 1, alteration: 0, octave: 0 },
    drum: "hat",
  })),
});
it("generates exact 3:2 and 5:4 as ordinary events, then reports declared-grid drift", () => {
  let e = create();
  const source = structuredClone(e.song!);
  e = rhythm(e, poly());
  e = rhythm(e, poly("five", [5, 4]));
  expect(polyrhythmGrid(e.song!, "poly")[0]!.lanes[0]!.actual).toEqual([
    [0, 1],
    [4, 3],
    [8, 3],
  ]);
  expect(polyrhythmGrid(e.song!, "five")[0]!.lanes[0]!.expected).toEqual([
    [0, 1],
    [4, 5],
    [8, 5],
    [12, 5],
    [16, 5],
  ]);
  expect(
    polyrhythmGrid(e.song!, "five")[0]!.lanes.every((l) => l.matches),
  ).toBe(true);
  expect(
    sounds(e.song!).filter((n) => n.occurrenceId === "poly-o0"),
  ).toHaveLength(3);
  e = rhythm(e, { type: "rotate", patternId: "poly-p0", amount: [1, 3] });
  const lane = polyrhythmGrid(e.song!, "poly")[0]!.lanes[0]!;
  expect(lane.matches).toBe(false);
  expect(lane.missing).toHaveLength(3);
  expect(lane.extra).toHaveLength(3);
  expect(e.song!.tables.events).toMatchObject(source.tables.events);
  expect(e.song!.tables.occurrences.bass).toEqual(
    source.tables.occurrences.bass,
  );
  const music = sounds(e.song!);
  e = edit(e, {
    kind: "edit",
    changes: [{ table: "polyrhythms", id: "poly", value: null }],
  });
  expect(sounds(e.song!)).toEqual(music);
});
it("scales exact tuplets and releases according to policy, with a lossless inverse", () => {
  let e = create();
  e.song!.tables.patterns.seven!.groups = [
    [1, 1],
    [1, 1],
    [3, 2],
  ];
  const source = structuredClone(e.song!);
  const scaled = rhythm(e, {
    type: "scale",
    patternId: "seven",
    factor: [2, 3],
    releases: "scale",
    phases: "follow",
  });
  expect(scaled.song!.tables.patterns.seven!.length).toEqual([7, 3]);
  expect(scaled.song!.tables.events.chord!.performance[0]).toEqual({
    memberId: "third",
    offset: [1, 3],
    duration: [2, 3],
  });
  const inverse = rhythm(scaled, {
    type: "scale",
    patternId: "seven",
    factor: [3, 2],
    releases: "scale",
    phases: "follow",
  });
  expect(inverse.song).toEqual(source);
  const preserved = rhythm(e, {
    type: "scale",
    patternId: "seven",
    factor: [2, 3],
    releases: "preserve",
    phases: "follow",
  });
  expect(preserved.song!.tables.events.chord!.duration).toEqual([4, 1]);
  expect(preserved.song!.tables.events.chord!.performance[0]!.duration).toEqual(
    [1, 1],
  );
  expect(() =>
    rhythm(e, {
      type: "scale",
      patternId: "seven",
      factor: [0, 1],
      releases: "scale",
      phases: "keep",
    }),
  ).toThrow();
});
it("wraps negative phases and attacks exactly, rotates accents past rests, and bounds displacement", () => {
  let e = create();
  e.song!.tables.events.chord!.accent = 1;
  e.song!.tables.events.melody!.accent = 0.2;
  e = rhythm(e, { type: "phase", occurrenceId: "guitar", amount: [-1, 3] });
  expect(e.song!.tables.occurrences.guitar!.phase).toEqual([19, 6]);
  const original = structuredClone(e.song!);
  e = rhythm(e, { type: "rotate", patternId: "seven", amount: [-1, 2] });
  expect(e.song!.tables.events.chord!.start).toEqual([3, 1]);
  expect(e.song!.tables.events.chord!.duration).toEqual([4, 1]);
  e = rhythm(e, { type: "accents", patternId: "seven", steps: -1 });
  expect(e.song!.tables.events.chord!.accent).toBe(0.2);
  expect(e.song!.tables.events.melody!.accent).toBe(1);
  expect(e.song!.tables.events.rest!.accent).toBe(
    original.tables.events.rest!.accent,
  );
  expect(() =>
    rhythm(e, { type: "displace", occurrenceId: "guitar", amount: [-1, 2] }),
  ).toThrow();
  e = rhythm(e, { type: "displace", occurrenceId: "guitar", amount: [1, 2] });
  expect(e.song!.tables.occurrences.guitar!.start).toEqual([1, 2]);
  expect(e.song!.tables.occurrences.guitar!.phase).toEqual([19, 6]);
  expect(() =>
    rhythm(create(arrangementSong()), {
      type: "displace",
      occurrenceId: "guitar",
      amount: [1, 2],
    }),
  ).toThrow();
});
it("splices group boundaries and independent member attacks without stretching releases", () => {
  let e = create();
  e.song!.tables.patterns.seven!.groups = [
    [1, 1],
    [1, 1],
    [3, 2],
  ];
  const original = structuredClone(e.song!);
  e = rhythm(e, {
    type: "splice",
    patternId: "seven",
    at: [1, 1],
    amount: [1, 3],
    mode: "insert",
    attacks: "reject",
    phases: "follow",
  });
  expect(e.song!.tables.patterns.seven!.groups).toEqual([
    [1, 1],
    [4, 3],
    [3, 2],
  ]);
  expect(e.song!.tables.events.melody!.start).toEqual([11, 6]);
  e = rhythm(e, {
    type: "splice",
    patternId: "seven",
    at: [1, 1],
    amount: [1, 3],
    mode: "remove",
    attacks: "reject",
    phases: "follow",
  });
  expect(e.song).toEqual(original);
  e = rhythm(e, {
    type: "splice",
    patternId: "seven",
    at: [1, 4],
    amount: [1, 4],
    mode: "insert",
    attacks: "reject",
    phases: "follow",
  });
  expect(e.song!.tables.events.chord!.performance[0]).toEqual({
    memberId: "third",
    offset: [3, 4],
    duration: [1, 1],
  });
  expect(e.song!.tables.events.chord!.duration).toEqual([4, 1]);
  expect(() =>
    rhythm(e, {
      type: "splice",
      patternId: "seven",
      at: [3, 4],
      amount: [1, 4],
      mode: "remove",
      attacks: "delete",
      phases: "follow",
    }),
  ).toThrow("chord-member attack");
});
it("removal requires explicit event deletion and maps removed phases without losing other voices", () => {
  let e = create();
  e.song!.tables.occurrences.guitar!.phase = [13, 4];
  const action: RhythmAction = {
    type: "splice",
    patternId: "seven",
    at: [3, 1],
    amount: [1, 2],
    mode: "remove",
    attacks: "reject",
    phases: "follow",
  };
  expect(() => rhythm(e, action)).toThrow("choose delete");
  expect(() =>
    rhythm(e, { ...action, attacks: "delete", phases: "keep" }),
  ).toThrow();
  const bass = sounds(e.song!).filter((n) => n.partId === "bass");
  e = rhythm(e, { ...action, attacks: "delete" });
  expect(e.song!.tables.events.rest).toBeUndefined();
  expect(e.song!.tables.occurrences.guitar!.phase).toEqual([0, 1]);
  expect(sounds(e.song!).filter((n) => n.partId === "bass")).toEqual(bass);
});
it("variations isolate chord definitions and compare timing, pitch, articulation, and added/removed origins", () => {
  let e = create();
  const original = structuredClone(e.song!);
  e = rhythm(e, {
    type: "variation",
    patternId: "seven",
    newId: "var",
    name: "A′",
  });
  expect(
    comparePatterns(e.song!, "seven", "var").rows.every(
      (r) => r.status === "unchanged",
    ),
  ).toBe(true);
  const chord = Object.values(e.song!.tables.events).find(
    (n) => n.patternId === "var" && n.kind === "chord",
  )!;
  const definition = e.song!.tables.chords[chord.chordId!]!;
  e = edit(e, {
    kind: "edit",
    changes: [
      {
        table: "chords",
        id: definition.id,
        value: {
          ...definition,
          notes: definition.notes.map((n) => ({
            ...n,
            pitch: { ...n.pitch, alteration: 1 },
          })),
        },
      },
      {
        table: "events",
        id: chord.id,
        value: { ...chord, start: [1, 3], articulation: "ghost" },
      },
    ],
  });
  const row = comparePatterns(e.song!, "seven", "var").rows.find(
    (r) => r.originId === "chord",
  )!;
  expect(row.fields).toEqual([
    "start",
    "articulation",
    "notes",
    "interpretation",
  ]);
  expect(e.song!.tables.chords.tonic).toEqual(original.tables.chords.tonic);
  expect(e.song!.tables.events.chord).toEqual(original.tables.events.chord);
  expect(
    comparePatterns(e.song!, "seven", "eight").rows.every(
      (r) => r.status === "added" || r.status === "removed",
    ),
  ).toBe(true);
});
it("maps seven/eight, incompatible phases, and local appearances with explicit bounded output", () => {
  const e = create();
  const map = alignmentMap(e.song!, ["guitar", "drums"], [0, 1], [32, 1]);
  expect(map.common).toEqual([
    [0, 1],
    [28, 1],
  ]);
  e.song!.tables.occurrences.drums!.phase = [1, 3];
  expect(
    alignmentMap(e.song!, ["guitar", "drums"], [0, 1], [32, 1]).common,
  ).toEqual([]);
  let local = create(arrangementSong());
  local = edit(local, {
    kind: "structure",
    action: { type: "repeat", appearanceId: "verse", newId: "again" },
  });
  expect(
    alignmentMap(local.song!, ["guitar", "drums"], [0, 1], [48, 1]).common,
  ).toEqual([
    [0, 1],
    [16, 1],
  ]);
  e.song!.tables.occurrences.drums!.phase = [0, 1];
  e.song!.tables.patterns.eight!.length = [1, 100];
  e.song!.tables.patterns.seven!.length = [1, 100];
  const dense = alignmentMap(e.song!, ["guitar", "drums"], [0, 1], [32, 1]);
  expect(dense.truncated).toBe(true);
  expect(dense.common).toHaveLength(512);
  expect(dense.totalCommon).toBe(3200);
});
it("section variations clone declarations and relink scoped voices, preserving the original grid", () => {
  let e = create(arrangementSong());
  e = rhythm(e, { ...poly(), sectionId: "verse" } as RhythmAction);
  const grid = polyrhythmGrid(e.song!, "poly");
  e = edit(e, {
    kind: "structure",
    action: { type: "repeat", appearanceId: "verse", newId: "again" },
  });
  e = edit(e, {
    kind: "structure",
    action: {
      type: "variation",
      appearanceId: "again",
      newId: "var",
      name: "A′",
    },
  });
  const copy = Object.values(e.song!.tables.polyrhythms).find(
    (p) => p.sectionId === "var",
  )!;
  expect(
    copy.lanes.every(
      (l) => e.song!.tables.occurrences[l.occurrenceId]!.sectionId === "var",
    ),
  ).toBe(true);
  expect(polyrhythmGrid(e.song!, "poly")).toEqual(grid);
  expect(
    polyrhythmGrid(e.song!, copy.id)[0]!.lanes.every((l) => l.matches),
  ).toBe(true);
});
it("rejects corrupt groups, duplicate origins, and incompatible declaration references", () => {
  const s = acceptance();
  s.tables.patterns.seven!.groups = [[1, 1]];
  expect(validateSong(s).ok).toBe(false);
  s.tables.patterns.seven!.groups = [];
  s.tables.events.melody!.originId = "chord";
  expect(validateSong(s).ok).toBe(false);
  s.tables.events.melody!.originId = "melody";
  let e = create(s);
  expect(() => rhythm(e, poly("bad", [3, 65]))).toThrow();
  e = rhythm(e, poly());
  const p = e.song!.tables.polyrhythms.poly!;
  p.lanes[1]!.occurrenceId = p.lanes[0]!.occurrenceId;
  expect(validateSong(e.song).ok).toBe(false);
});
it("previews full shared impact and atomically undoes/redoes a transform", () => {
  let e = create();
  const original = structuredClone(e.song!);
  const command: Command = {
    kind: "rhythm",
    action: {
      type: "scale",
      patternId: "seven",
      factor: [2, 1],
      releases: "preserve",
      phases: "follow",
    },
  };
  const preview = previewCommand(e, command);
  expect(preview.affectedPlacements.map((o) => o.id)).toEqual(["guitar"]);
  expect(e.song).toEqual(original);
  e = edit(e, command);
  const changed = structuredClone(e.song!);
  e = edit(e, { kind: "undo", targetId: "op-1" });
  expect(e.song).toEqual(original);
  e = edit(e, { kind: "undo", targetId: "op-2" });
  expect(e.song).toEqual(changed);
});
it("migrates schema 2 histories additively and preserves later lineage after reload", () => {
  let e = create();
  const legacy: any = structuredClone(e);
  legacy.song.schemaVersion = 2;
  delete legacy.song.tables.polyrhythms;
  for (const p of Object.values(legacy.song.tables.patterns) as any[])
    delete p.groups;
  for (const n of Object.values(legacy.song.tables.events) as any[])
    delete n.originId;
  for (const d of legacy.history[0].deltas) {
    if (d.table === "patterns") delete d.after.groups;
    if (d.table === "events") delete d.after.originId;
  }
  const fingerprint = legacy.history[0].fingerprint;
  e = hydrateEnvelope(legacy);
  expect(e.history[0]!.fingerprint).toBe(fingerprint);
  expect(sounds(e.song!)).toEqual(sounds(acceptance()));
  e = rhythm(e, {
    type: "variation",
    patternId: "seven",
    newId: "var",
    name: "A′",
  });
  e = hydrateEnvelope(e);
  expect(
    comparePatterns(e.song!, "seven", "var").rows.every(
      (r) => r.status === "unchanged",
    ),
  ).toBe(true);
  e = edit(e, { kind: "undo", targetId: "op-1" });
  e = edit(e, { kind: "undo", targetId: "create" });
  expect(e.song).toBeNull();
});
