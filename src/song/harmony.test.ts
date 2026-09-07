import { it, expect } from "bun:test";
import { recipe, harmonySong } from "../../tests/harmony.ts";
import { buildChord } from "./chord-builder.ts";
import { TONIC, shiftPitch, pc } from "./harmony-pitch.ts";
import { semitone, noteEvent } from "./model.ts";
import {
  applyCommand,
  previewCommand,
  type Command,
  type Envelope,
} from "./commands.ts";
import type { HarmonyAction } from "./harmony.ts";
import {
  harmonicContext,
  harmonicSpans,
  chordCandidates,
  soundingHarmony,
  interpretations,
} from "./harmony-analysis.ts";
import { voiceLeading } from "./voice-leading.ts";
import { sounds } from "./timeline.ts";
import { validateSong } from "./validate.ts";
import { hydrateEnvelope } from "./history.ts";
const create = () => {
  const s = harmonySong();
  return applyCommand(
    undefined,
    {
      songId: s.id,
      expectedRevision: 0,
      operationId: "create",
      label: "Create",
      command: { kind: "replace", song: s },
    },
    0,
  );
};
const edit = (e: Envelope, command: Command) =>
  applyCommand(
    e,
    {
      songId: e.id,
      expectedRevision: e.revision,
      operationId: `edit-${e.revision}`,
      label: "Edit",
      command,
    },
    0,
  );
const harmonic = (e: Envelope, action: HarmonyAction) =>
  edit(e, { kind: "harmony", action });
it("spells applied, minor and contextual chords without an absolute key", () => {
  const c = buildChord(
    "c",
    "Applied",
    recipe({ root: "V", target: "V", extension: 7 }),
  );
  expect(c.notes.map((n) => n.pitch)).toEqual([
    { degree: 2, alteration: 0, octave: 1 },
    { degree: 4, alteration: 1, octave: 1 },
    { degree: 6, alteration: 0, octave: 1 },
    { degree: 1, alteration: 0, octave: 2 },
  ]);
  expect(c.label).toBe("V7/V");
  expect(
    buildChord("m", "Minor", recipe({ quality: "minor" })).notes.map((n) =>
      semitone(n.pitch),
    ),
  ).toEqual([0, 3, 7]);
  expect(
    buildChord(
      "local",
      "Local",
      recipe({ tonic: { degree: 5, alteration: 0, octave: 0 } }),
    ).notes.map((n) => semitone(n.pitch)),
  ).toEqual([7, 11, 14]);
  expect(
    buildChord("b", "Borrowed", recipe({ root: "bVI" })).notes.map(
      (n) => n.pitch.alteration,
    ),
  ).toEqual([-1, 0, -1]);
  expect(shiftPitch({ degree: 7, alteration: -1, octave: 0 }, 3, 5)).toEqual({
    degree: 3,
    alteration: -1,
    octave: 1,
  });
});
it("preserves extensions, altered tones, omissions, suspensions and retained-bass inversions", () => {
  const c = buildChord(
    "c",
    "Colour",
    recipe({
      extension: 13,
      seventh: "major",
      tones: [{ degree: 11, alteration: 1 }],
      omit: [3, 5],
    }),
  );
  expect(c.notes.map((n) => semitone(n.pitch))).toEqual([0, 11, 14, 18, 21]);
  expect(c.notes.find((n) => n.id === "tone-11")!.pitch).toEqual({
    degree: 4,
    alteration: 1,
    octave: 1,
  });
  expect(
    buildChord("sus", "Suspended", recipe({ quality: "sus4" })).notes.map((n) =>
      semitone(n.pitch),
    ),
  ).toEqual([0, 5, 7]);
  const inversion = buildChord("inv", "Inverted", recipe({ inversion: 1 }));
  expect(inversion.notes.map((n) => semitone(n.pitch))).toEqual([4, 7, 12]);
  expect(inversion.label).toContain("bass 3");
  expect(() => buildChord("x", "Empty", recipe({ omit: [1, 3, 5] }))).toThrow(
    "retain",
  );
  expect(() => buildChord("x", "Invalid", recipe({ inversion: 3 }))).toThrow(
    "Inversion",
  );
  expect(() =>
    buildChord(
      "x",
      "Invalid",
      recipe({
        tones: [
          { degree: 9, alteration: 1 },
          { degree: 9, alteration: 0 },
        ],
      }),
    ),
  ).toThrow("unique");
});
it("regions repeat, resolve local precedence at exact boundaries, and do not repitch music", () => {
  let e = create();
  const original = sounds(e.song!);
  expect(harmonicContext(e.song!, [4, 1]).tonic.degree).toBe(5);
  expect(harmonicContext(e.song!, [8, 1]).tonic.degree).toBe(1);
  e = edit(e, {
    kind: "structure",
    action: { type: "repeat", appearanceId: "verse", newId: "again" },
  });
  expect(
    harmonicSpans(e.song!)
      .filter((h) => h.id === "local")
      .map((h) => h.start),
  ).toEqual([
    [4, 1],
    [20, 1],
  ]);
  e = edit(e, {
    kind: "structure",
    action: {
      type: "variation",
      appearanceId: "again",
      newId: "var",
      name: "A′",
    },
  });
  expect(
    Object.values(e.song!.tables.harmony).some((h) => h.sectionId === "var"),
  ).toBe(true);
  const s = harmonySong();
  s.tables.harmony.local!.tonic = { degree: 4, alteration: 0, octave: 0 };
  s.tables.harmony.local!.mode = "minor";
  expect(sounds(s)).toEqual(original);
  s.tables.harmony.overlap = {
    ...s.tables.harmony.local!,
    id: "overlap",
    start: [7, 1],
  };
  expect(validateSong(s).ok).toBe(false);
  delete s.tables.harmony.overlap;
  s.tables.harmony.local!.duration = [20, 1];
  expect(validateSong(s).ok).toBe(false);
});
it("build assignment isolates other parts and requires explicit performance reset", () => {
  let e = create();
  const source = structuredClone(e.song!);
  const a: HarmonyAction = {
    type: "build",
    newId: "applied",
    name: "Applied",
    recipe: recipe({ root: "V", target: "V", extension: 7 }),
    eventId: "chord",
    performance: "reject",
  };
  expect(() => harmonic(e, a)).toThrow("explicitly reset");
  e = harmonic(e, { ...a, performance: "reset" });
  expect(e.song!.tables.events.chord!.performance).toEqual([]);
  expect(e.song!.tables.chords.tonic).toEqual(source.tables.chords.tonic);
  expect(e.song!.tables.events.melody).toEqual(source.tables.events.melody);
  expect(e.song!.tables.events.pedal).toEqual(source.tables.events.pedal);
  expect(e.song!.tables.events.chord!.duration).toEqual([4, 1]);
  e = edit(e, { kind: "undo", targetId: "edit-1" });
  expect(e.song).toEqual(source);
});
it("transposition copies shared chords and preserves time, origins, rests and bass", () => {
  let e = create();
  const before = structuredClone(e.song!);
  e = harmonic(e, {
    type: "transpose",
    patternId: "seven",
    newId: "shifted",
    steps: 3,
    semitones: 5,
  });
  const t = e.song!.tables;
  expect(t.chords.tonic).toEqual(before.tables.chords.tonic);
  expect(t.events.chord!.chordId).not.toBe("tonic");
  expect(t.chords[t.events.chord!.chordId!]!.label).toBeNull();
  expect(t.events.melody!.pitch).toEqual({
    degree: 5,
    alteration: 0,
    octave: 1,
  });
  expect(t.events.chord!.performance).toEqual(
    before.tables.events.chord!.performance,
  );
  expect(t.events.rest).toEqual(before.tables.events.rest);
  expect(t.events.pedal).toEqual(before.tables.events.pedal);
  expect(t.events.melody!.originId).toBe("melody");
  expect(() =>
    harmonic(e, {
      type: "transpose",
      patternId: "seven",
      newId: "too-far",
      steps: 100,
      semitones: 120,
    }),
  ).toThrow("range");
});
it("sounding harmony excludes silent members, events and parts", () => {
  const s = harmonySong();
  const event = s.tables.events.chord!;
  event.performance.push({
    memberId: "root",
    offset: [0, 1],
    duration: [4, 1],
    gain: 0,
  });
  const guitar = () =>
    soundingHarmony(s, [0, 1]).voices.find((v) => v.id === "guitar")?.notes ??
    [];
  expect(guitar().map((n) => n.pitch!.degree)).toEqual([5]);
  event.accent = 0;
  expect(guitar()).toEqual([]);
  expect(soundingHarmony(s, [0, 1]).voices.some((v) => v.id === "bass")).toBe(
    true,
  );
  s.tables.parts.bass!.volume = 0;
  expect(soundingHarmony(s, [0, 1]).voices).toEqual([]);
});
it("staggered members inherit or override expression once while a separate pedal rings", () => {
  let e = create();
  e = harmonic(e, {
    type: "perform",
    eventId: "chord",
    order: ["fifth", "root", "third"],
    step: [1, 3],
    duration: null,
  });
  const event = e.song!.tables.events.chord!;
  expect(
    event.performance.find((m) => m.memberId === "third")!.duration,
  ).toEqual([1, 1]);
  e = edit(e, {
    kind: "edit",
    changes: [
      {
        table: "events",
        id: event.id,
        value: {
          ...event,
          articulation: "staccato",
          performance: event.performance.map((m) => ({
            ...m,
            gain: 0.5,
            articulation: m.memberId === "root" ? "normal" : "inherit",
          })),
        },
      },
    ],
  });
  const first = sounds(e.song!).filter(
    (n) => n.eventId === "chord" && n.start[0] < 3,
  );
  expect(first.map((n) => n.start)).toEqual([
    [0, 1],
    [1, 3],
    [2, 3],
  ]);
  expect(first.map((n) => n.duration)).toEqual([
    [2, 1],
    [8, 3],
    [1, 2],
  ]); // root is clipped by this voice's rest at 3
  expect(first[0]!.gain).toBeCloseTo(0.6 * 0.7 * 0.5);
  expect(sounds(e.song!).find((n) => n.eventId === "pedal")!.duration).toEqual([
    30, 1,
  ]);
  expect(
    soundingHarmony(e.song!, [1, 3]).voices.some((v) => v.id === "bass"),
  ).toBe(true);
  expect(() =>
    harmonic(e, {
      type: "perform",
      eventId: "chord",
      order: ["root", "root", "third"],
      step: [1, 3],
      duration: null,
    }),
  ).toThrow("exactly once");
});
it("expression ramps selected events and scales releases while preserving other voices", () => {
  let e = create();
  const before = structuredClone(e.song!);
  e = harmonic(e, {
    type: "expression",
    eventIds: ["melody", "chord"],
    from: 0.2,
    to: 0.8,
    articulation: "ghost",
    gate: [2, 3],
  });
  expect(e.song!.tables.events.chord!.accent).toBe(0.2);
  expect(e.song!.tables.events.melody!.accent).toBe(0.8);
  expect(e.song!.tables.events.chord!.performance[0]!.duration).toEqual([2, 3]);
  expect(e.song!.tables.events.chord!.start).toEqual([0, 1]);
  expect(e.song!.tables.events.rest).toEqual(before.tables.events.rest);
  expect(e.song!.tables.events.pedal).toEqual(before.tables.events.pedal);
  expect(() =>
    harmonic(e, {
      type: "expression",
      eventIds: ["rest"],
      from: 0,
      to: 1,
      articulation: "normal",
      gate: [1, 1],
    }),
  ).toThrow("rests");
});
it("voice leading finds a minimum assignment and reports unmatched members without changing pitch classes", () => {
  const s = harmonySong();
  s.tables.chords.a = buildChord("a", "I", recipe());
  s.tables.chords.b = buildChord("b", "IV", recipe({ root: "IV" }));
  const r = voiceLeading(s, "a", "b", 1);
  expect(r.totalMotion).toBe(3);
  expect(r.notes.map((n) => pc(semitone(n.pitch)))).toEqual([5, 9, 0]);
  expect(s.tables.chords.b!.notes.map((n) => semitone(n.pitch))).toEqual([
    5, 9, 12,
  ]);
  s.tables.chords.b!.notes.push({
    id: "seventh",
    pitch: { degree: 3, alteration: 0, octave: 1 },
  });
  expect(
    voiceLeading(s, "a", "b", 1).moves.filter((m) => m.status === "added"),
  ).toHaveLength(1);
  expect(
    voiceLeading(s, "b", "a", 1).moves.filter((m) => m.status === "removed"),
  ).toHaveLength(1);
  expect(() => voiceLeading(s, "a", "b", 3)).toThrow("radius");
});
it("interpretations retain ambiguity and explicit unresolved collections", () => {
  const s = harmonySong();
  s.tables.chords.six = buildChord("six", "Six", recipe({ extension: 6 }));
  const result = chordCandidates(s, "six");
  expect(result.candidates.map((c) => c.symbol)).toContain("I6");
  expect(result.candidates.map((c) => c.symbol)).toContain("vi7");
  expect(result.inMode).toBe(true);
  expect(
    interpretations([{ degree: 1, alteration: 0, octave: 0 }], TONIC)
      .unresolved,
  ).toBe(true);
  expect(
    interpretations(
      [{ degree: 1, alteration: 0, octave: 0 }],
      TONIC,
      "free mode",
    ).inMode,
  ).toBeNull();
});
it("harmonic previews expose shared chord impact and undo/redo restores notes and labels", () => {
  let e = create();
  e = harmonic(e, {
    type: "build",
    newId: "target",
    name: "Target",
    recipe: recipe({ root: "IV" }),
    eventId: "chord",
    performance: "reset",
  });
  const before = structuredClone(e.song!);
  const cmd: Command = {
    kind: "harmony",
    action: {
      type: "voiceLead",
      sourceId: "tonic",
      targetId: "target",
      octaveRadius: 1,
    },
  };
  expect(previewCommand(e, cmd).affectedPlacements.map((o) => o.id)).toContain(
    "guitar",
  );
  e = edit(e, cmd);
  const after = structuredClone(e.song!);
  expect(after.tables.chords.target!.label).toBeNull();
  e = edit(e, { kind: "undo", targetId: "edit-2" });
  expect(e.song).toEqual(before);
  e = edit(e, { kind: "undo", targetId: "edit-3" });
  expect(e.song).toEqual(after);
});
it("migrates actual schema 3 history and retains original retries and creation undo", () => {
  const s: any = harmonySong();
  delete s.tables.harmony;
  s.schemaVersion = 3;
  for (const c of Object.values(s.tables.chords) as any[]) delete c.labelTonic;
  const m = {
    songId: s.id,
    expectedRevision: 0,
    operationId: "old",
    label: "Old import",
    command: { kind: "replace" as const, song: s },
  };
  const legacy: any = applyCommand(undefined, m, 0);
  legacy.song = s;
  for (const d of legacy.history[0].deltas)
    if (d.table === "chords") delete d.after.labelTonic;
  const e = hydrateEnvelope(legacy);
  expect(e.song!.schemaVersion).toBe(5);
  expect(e.history[0]!.fingerprint).toBe(JSON.stringify(m));
  expect(e.song!.tables.chords.tonic!.labelTonic).toEqual(TONIC);
  expect(e.song!.tables.harmony).toEqual({});
  expect(edit(e, { kind: "undo", targetId: "old" }).song).toBeNull();
});

it("distinguishes half-diminished and fully diminished sevenths and labels suspended extensions", () => {
  const half = buildChord(
    "h",
    "Half",
    recipe({
      root: "VII",
      quality: "diminished",
      extension: 7,
      seventh: "minor",
    }),
  );
  const full = buildChord(
    "f",
    "Full",
    recipe({
      root: "VII",
      quality: "diminished",
      extension: 7,
      seventh: "diminished",
    }),
  );
  expect(half.label).toBe("viiø7");
  expect(full.label).toBe("vii°7");
  expect(semitone(half.notes[3]!.pitch) - semitone(half.notes[0]!.pitch)).toBe(
    10,
  );
  expect(semitone(full.notes[3]!.pitch) - semitone(full.notes[0]!.pitch)).toBe(
    9,
  );
  expect(
    buildChord("s", "Suspended", recipe({ quality: "sus4", extension: 7 }))
      .label,
  ).toBe("I7sus4");
  expect(() =>
    buildChord("x", "Invalid", recipe({ extension: 7, seventh: "diminished" })),
  ).toThrow("Diminished sevenths");
});
