// The existing TypeScript implementation is the migration reference, not a
// runtime dependency of the Rust workspace. Regenerate deliberately; CI checks drift.
import { historyStacks } from "../../src/song/history.ts";
import type { StructureAction } from "../../src/song/structure.ts";
import type { RhythmAction } from "../../src/song/rhythm.ts";
import type { HarmonyAction } from "../../src/song/harmony.ts";
import type { ChordRecipe } from "../../src/song/chord-builder.ts";
import { changeNotes, removeNotes, combineNotes } from "../../src/song/note-edit.ts";
import { annotations } from "../../src/song/arrangement.ts";
import { alignmentMap, polyrhythmGrid, comparePatterns } from "../../src/song/rhythm-analysis.ts";
import { harmonicSpans, harmonicContext, interpretations, chordCandidates, soundingHarmony } from "../../src/song/harmony-analysis.ts";
import { tablature } from "../../src/song/tablature.ts";
import { fretPositions, fingeringIssues, targetPitch } from "../../src/song/fretted.ts";
import { takePlacements } from "../../src/song/media.ts";
import { migrateEntity, migrateSong } from "../../src/song/migrate.ts";
import { sounds, bars, songEnd, segments, alignment, secondsPerQuarter, clicks, cycleStarts, restSpans } from "../../src/song/timeline.ts";
import { placements } from "../../src/song/arrangement.ts";
import { emptySong, noteEvent, semitone, type Fingering, type Performance } from "../../src/song/model.ts";
import { applyCommand, difference, type Envelope, type Mutation, type Change } from "../../src/song/commands.ts";
import { validateSong } from "../../src/song/validate.ts";
import { time, add, sub, mul, cmp, modulo, value, type Time } from "../../src/song/time.ts";
import { readFileSync, writeFileSync } from "node:fs";

const song = emptySong("desktop-fixture", "Mixed-meter sketch");
const t = song.tables;
t.parts.guitar = { id: "guitar", name: "Guitar", instrument: "guitar", volume: 0.8, muted: false };
t.voices.lead = { id: "lead", name: "Lead", partId: "guitar" };
t.sections.verse = { id: "verse", name: "Verse", sourceId: null, barIds: ["seven", "five"] };
t.bars.seven = { id: "seven", name: "7/8", sectionId: "verse", numerator: 7, denominator: 8, groups: [2, 2, 3], actual: null };
t.bars.five = { id: "five", name: "5/4", sectionId: "verse", numerator: 5, denominator: 4, groups: [3, 2], actual: null };
t.arrangement.verse1 = { id: "verse1", name: "Verse", sectionId: "verse" };
song.arrangementOrder = ["verse1"];
t.patterns.riff = { id: "riff", name: "Riff", length: [7, 2], groups: [[1, 1], [1, 1], [3, 2]], sourceId: null };
t.occurrences.lead1 = { id: "lead1", name: "Lead", sectionId: "verse", patternId: "riff", voiceId: "lead", start: [0, 1], span: [17, 2], phase: [0, 1], boundary: "continue", tails: "ring" };
t.events.note = { ...noteEvent("note", "riff"), start: [1, 3], duration: [2, 3], pitch: { degree: 7, alteration: -1, octave: 1 } };
t.chords.chord = { id: "chord", name: "Open chord", labelTonic: { degree: 1, alteration: 0, octave: 0 }, label: "I", notes: [
  { id: "root", pitch: { degree: 1, alteration: 0, octave: 0 } },
  { id: "third", pitch: { degree: 3, alteration: 0, octave: 0 } },
  { id: "fifth", pitch: { degree: 5, alteration: 0, octave: 1 } },
] };
t.events.harmony = { ...noteEvent("harmony", "riff"), kind: "chord", chordId: "chord", start: [1, 1], duration: [3, 1] };
const valid = validateSong(song);
if (!valid.ok) throw new Error(valid.error);

type Action = { kind: "rename"; title: string } |
  { kind: "moveNote"; eventId: string; memberId: string | null; start: Time } |
  { kind: "undo"; targetId: string };
type Request = Omit<Mutation, "command"> & { action: Action };
const request = (operationId: string, expectedRevision: number, action: Action): Request =>
  ({ songId: song.id, expectedRevision, operationId, label: operationId, action });
const move = (eventId: string, start: Time, memberId: string | null = null): Action => ({ kind: "moveNote", eventId, memberId, start });
const rename: Action = { kind: "rename", title: "A new ending" };
const requests: Request[] = [
  request("rename", 0, rename),
  request("note-third", 1, move("note", [2, 3])),
  request("root-earlier", 2, move("harmony", [1, 3], "root")),
  request("undo-title", 3, { kind: "undo", targetId: "rename" }),
  request("rename", 0, rename), // Lost acknowledgement, retry after other edits.
  request("rename", 0, { kind: "rename", title: "Different content" }),
  request("stale", 1, move("note", [1, 1])),
  request("negative", 4, move("note", [-1, 3])),
  request("boundary", 4, move("note", [7, 2])),
  request("missing", 4, move("gone", [1, 1])),
  request("missing-member", 4, move("harmony", [1, 1], "gone")),
  request("note-again", 4, move("note", [4, 3])),
  request("undo-conflict", 5, { kind: "undo", targetId: "note-third" }),
  request("undo-root", 5, { kind: "undo", targetId: "root-earlier" }),
  request("redo-root", 6, { kind: "undo", targetId: "undo-root" }),
  request("no-change", 7, move("note", [4, 3])),
];

let current: Envelope = { id: song.id, revision: 0, song: structuredClone(song), updatedAt: 0, history: [] };
const history: { step: number; receipts: { operationId: string; undoOf: string | null; deltaCount: number; beforeDeleted: boolean; afterDeleted: boolean }[]; undo: string[]; redo: string[] }[] = [];
const cases = requests.map((r, index) => {
  const a = r.action;
  const before = structuredClone(current.song);
  let outcome;
  try {
    // Match the browser's receipt-first retry handling. An existing operation
    // must be resolved before translating a note edit against changed state.
    const earlier = requests.slice(0, index).find((q) => q.operationId === r.operationId);
    const duplicate = current.history.some((h) => h.operationId === r.operationId);
    if (duplicate) {
      if (JSON.stringify(earlier) !== JSON.stringify(r)) throw new Error("Operation ID reused with different content");
    } else {
      const command: Mutation["command"] = a.kind === "rename" ? { kind: "edit", changes: [{ table: "meta", id: "title", value: a.title }] }
        : a.kind === "undo" ? a
        : { kind: "edit", changes: changeNotes(current.song!, [a]) };
      const { action: _, ...m } = r;
      current = applyCommand(current, { ...m, command }, index);
    }
    outcome = { request: r, ok: true as const, changes: difference(before, current.song), revision: current.revision };
  } catch (error) {
    outcome = { request: r, ok: false as const, error: (error as Error).message, changes: difference(before, current.song), revision: current.revision };
  }
  history.push({
    step: index,
    receipts: current.history.map(h => ({ operationId: h.operationId, undoOf: h.undoOf ?? null, deltaCount: h.deltas.length, beforeDeleted: h.beforeDeleted, afterDeleted: h.afterDeleted })),
    ...historyStacks(current.history),
  });
  return outcome;
});

const arithmetic = [
  [[1, 3], [1, 7]], [[-1, 3], [2, 7]], [[9007199254740991, 1], [1, 1]],
  [[9007199254740991, 9007199254740990], [-9007199254740991, 9007199254740990]],
  [[1, 9007199254740991], [1, 9007199254740989]],
] as [Time, Time][];
const times = arithmetic.flatMap(([a, b]) => Object.entries({ add, sub, mul, cmp }).map(([operation, fn]) => {
  try { return { a, b, operation, result: fn(time(...a), time(...b)) }; }
  catch (error) { return { a, b, operation, error: (error as Error).message }; }
}));
const modulos = [
  [[1, 3], [7, 2]], [[-1, 3], [7, 2]], [[-7, 2], [7, 2]],
  [[5, 1], [2, 1]], [[7, 2], [7, 2]], [[0, 1], [3, 1]],
  [[9007199254740991, 1], [7, 3]], [[1, 3], [9007199254740991, 1]],
  [[1, 2], [0, 1]], [[1, 2], [-3, 1]],
] as [Time, Time][];
for (const [a, b] of modulos) {
  try { times.push({ a, b, operation: "modulo", result: modulo(time(...a), time(...b)) }); }
  catch (error) { times.push({ a, b, operation: "modulo", error: (error as Error).message }); }
}
for (const [a] of arithmetic) times.push({ a, b: a, operation: "value", result: value(time(...a)) });
const audioNames = ["baseline", "member-offsets", "cut-tails", "repeated-section", "muted"];
const makeVariants = (): Record<string, typeof song> => {
  const variants: Record<string, typeof song> = { baseline: structuredClone(song) };
  const cut = structuredClone(song);
  cut.tables.occurrences.lead1!.tails = "cut";
  variants["cut-tails"] = cut;
  const repeated = structuredClone(song);
  repeated.tables.arrangement.verse2 = { id: "verse2", name: "Again", sectionId: "verse" };
  repeated.arrangementOrder.push("verse2");
  variants["repeated-section"] = repeated;
  const muted = structuredClone(song);
  muted.tables.parts.guitar!.muted = true;
  variants["muted"] = muted;
  // The audio reference gives every non-baseline variant member offsets.
  for (const name of ["member-offsets", "cut-tails", "repeated-section", "muted"]) {
    const input = name === "member-offsets" ? structuredClone(song) : variants[name]!;
    input.tables.events.harmony!.performance = [
      { memberId: "root", offset: time(1, 3), duration: time(2, 1) },
      { memberId: "fifth", offset: time(1, 1), duration: time(3, 1) },
    ];
    variants[name] = input;
  }
  const two = structuredClone(song);
  two.tables.occurrences.lead2 = { ...two.tables.occurrences.lead1!, id: "lead2", name: "Second", start: [7, 2], span: [5, 1] };
  variants["two-voices"] = two;
  const rest = structuredClone(song);
  rest.tables.events.rest1 = { ...noteEvent("rest1", "riff"), kind: "rest", start: [0, 1], duration: [1, 2] };
  variants["with-rest"] = rest;
  return variants;
};
const variants = makeVariants();
const audio = audioNames.map(name => {
  const input = variants[name]!;
  return { name, song: input, notes: sounds(input).map(n => ({ start:n.start, duration:n.duration, frequency:440 * 2 ** ((48 + semitone(n.pitch!) - 69) / 12), gain:n.gain * 0.2 })) };
});
const timeline = Object.entries(variants).map(([name, input]) => {
  const ends: Record<string, unknown> = {};
  try {
    const until = songEnd(input);
    ends.songEnd = until;
    ends.secondsPerQuarter = secondsPerQuarter(input);
    try { ends.alignment = alignment(input, ["lead1", "lead2"], [0, 1], until); }
    catch (error) { ends.alignmentError = (error as Error).message; }
  } catch (error) { ends.error = (error as Error).message; }
  try { ends.singleAlignmentError = alignment(input, ["lead1"], [0, 1], [100, 1]); }
  catch (error) { ends.singleAlignmentError = (error as Error).message; }
  try { ends.unknownAlignmentError = alignment(input, ["lead1", "missing"], [0, 1], [100, 1]); }
  catch (error) { ends.unknownAlignmentError = (error as Error).message; }
  const placed = placements(input);
  return {
    name,
    input,
    bars: bars(input),
    clicks: clicks(input),
    song: ends,
    segments: placed.map(o => ({ id: `${o.id}:${o.appearanceId ?? "global"}`, segments: segments(input, o) })),
    cycleStarts: placed.map(o => ({ id: `${o.id}:${o.appearanceId ?? "global"}`, starts: cycleStarts(input, o) })),
    restSpans: restSpans(input),
    sounds: sounds(input),
  };
});
const broken = (name: string, fn: (s: typeof song) => void) => {
  const input = structuredClone(song);
  fn(input);
  const result = validateSong(input);
  return { name, song: input, ok: result.ok, error: result.ok ? null : (result as { ok: false; error: string }).error };
};
const longText = (n: number) => "x".repeat(n);
const validateCases = [
  broken("prompts-overflow", s => { for (let i = 0; i < 33; i++) s.tables.prompts[`p${i}`] = { id: `p${i}`, name: "P", text: "x" }; }),
  broken("prompt-name", s => { s.tables.prompts.p = { id: "p", name: longText(201), text: "x" }; }),
  broken("perf-gain", s => { s.tables.events.harmony!.performance = [{ memberId: "root", offset: [0, 1], duration: [1, 1], gain: 2 }]; }),
  // Deliberately invalid values below: validateSong must reject each one.
  broken("perf-articulation", s => { s.tables.events.harmony!.performance = [{ memberId: "root", offset: [0, 1], duration: [1, 1], articulation: "wild" } as unknown as Performance]; }),
  broken("pattern-self", s => { s.tables.patterns.riff!.sourceId = "riff"; }),
  broken("pattern-missing", s => { s.tables.patterns.riff!.sourceId = "gone"; }),
  broken("pattern-cycle", s => {
    s.tables.patterns.riff2 = { ...s.tables.patterns.riff!, id: "riff2", name: "Again", sourceId: "riff" };
    s.tables.patterns.riff!.sourceId = "riff2";
  }),
  broken("section-self", s => { s.tables.sections.verse!.sourceId = "verse"; }),
  broken("section-cycle", s => {
    s.tables.sections.verse2 = { id: "verse2", name: "Again", sourceId: "verse", barIds: [] };
    s.tables.sections.verse!.sourceId = "verse2";
  }),
  broken("phrase-overflow", s => { s.tables.phrases.p1 = { id: "p1", name: "P", sectionId: "verse", start: [8, 1], duration: [2, 1] }; }),
  broken("lyric-text", s => { s.tables.lyrics.l1 = { id: "l1", name: "L", sectionId: "verse", start: [0, 1], duration: [1, 1], text: longText(10001), phraseId: null, partId: null }; }),
  broken("lyric-phrase", s => {
    s.tables.phrases.p1 = { id: "p1", name: "P", sectionId: "verse", start: [0, 1], duration: [4, 1] };
    s.tables.lyrics.l1 = { id: "l1", name: "L", sectionId: "verse", start: [5, 1], duration: [1, 1], text: "la", phraseId: "p1", partId: "guitar" };
  }),
  broken("poly-lanes", s => { s.tables.polyrhythms.p1 = { id: "p1", name: "P", sectionId: null, start: [0, 1], duration: [1, 1], lanes: [{ occurrenceId: "lead1", divisions: 4 }] }; }),
  broken("poly-divisions", s => { s.tables.polyrhythms.p1 = { id: "p1", name: "P", sectionId: "verse", start: [0, 1], duration: [1, 1], lanes: [{ occurrenceId: "lead1", divisions: 4 }, { occurrenceId: "lead1", divisions: 0 }] }; }),
  broken("poly-scope", s => { s.tables.polyrhythms.p1 = { id: "p1", name: "P", sectionId: null, start: [0, 1], duration: [1, 1], lanes: [{ occurrenceId: "lead1", divisions: 4 }, { occurrenceId: "lead1", divisions: 2 }] }; }),
  broken("poly-voice", s => {
    s.tables.occurrences.lead2 = { ...s.tables.occurrences.lead1!, id: "lead2", name: "Second", start: [0, 1], span: [1, 1] };
    s.tables.polyrhythms.p1 = { id: "p1", name: "P", sectionId: "verse", start: [0, 1], duration: [1, 1], lanes: [{ occurrenceId: "lead1", divisions: 4 }, { occurrenceId: "lead2", divisions: 2 }] };
  }),
  broken("harmony-overlap", s => {
    s.tables.harmony.h1 = { id: "h1", name: "A", sectionId: null, start: [0, 1], duration: [2, 1], tonic: { degree: 1, alteration: 0, octave: 0 }, mode: "major", annotation: "I" };
    s.tables.harmony.h2 = { id: "h2", name: "B", sectionId: null, start: [1, 1], duration: [2, 1], tonic: { degree: 5, alteration: 0, octave: 0 }, mode: "major", annotation: "V" };
  }),
  broken("harmony-exceeds", s => {
    s.tables.harmony.h1 = { id: "h1", name: "A", sectionId: "verse", start: [8, 1], duration: [2, 1], tonic: { degree: 1, alteration: 0, octave: 0 }, mode: "major", annotation: "I" };
  }),
  broken("fretted-part", s => { s.tables.fretted.f1 = { id: "f1", name: "F", partId: "nope", tonic: 40, tuning: [64, 59, 55, 50, 45, 40], capo: 0, maxFret: 12, handSpan: 4 }; }),
  broken("fretted-tuning", s => { s.tables.fretted.f1 = { id: "f1", name: "F", partId: "guitar", tonic: 40, tuning: [], capo: 0, maxFret: 12, handSpan: 4 }; }),
  broken("fingering-shape", s => {
    s.tables.fretted.f1 = { id: "f1", name: "F", partId: "guitar", tonic: 40, tuning: [64, 59, 55, 50, 45, 40], capo: 0, maxFret: 12, handSpan: 4 };
    s.tables.fingerings.g1 = { id: "g1", name: "G", arrangementId: "f1", occurrenceId: "???", eventId: "note", memberId: null, string: 1, fret: 0, technique: "pluck", fromId: null };
  }),
  broken("fingering-dup", s => {
    s.tables.fretted.f1 = { id: "f1", name: "F", partId: "guitar", tonic: 40, tuning: [64, 59, 55, 50, 45, 40], capo: 0, maxFret: 12, handSpan: 4 };
    const g: Fingering = { id: "g1", name: "G", arrangementId: "f1", occurrenceId: "lead1", eventId: "note", memberId: null, string: 1, fret: 0, technique: "pluck", fromId: null };
    s.tables.fingerings.g1 = g;
    s.tables.fingerings.g2 = { ...g, id: "g2", name: "G2" };
  }),
  broken("marker-negative", s => { s.tables.markers.m1 = { id: "m1", name: "M", at: [-1, 1] }; }),
];
const structural = (
  name: string,
  setup: (s: typeof song) => void,
  action: StructureAction,
  exact = true,
) => {
  const input = structuredClone(song);
  setup(input);
  const mutation = { songId: input.id, expectedRevision: 0, operationId: "op", label: "op", command: { kind: "structure", action } as const };
  try {
    const envelope = applyCommand({ id: input.id, revision: 0, song: input, updatedAt: 0, history: [] }, mutation, 100);
    return { name, song: input, mutation, ok: true as const, exact, songAfter: envelope.song };
  } catch (error) {
    return { name, song: input, mutation, ok: false as const, exact, error: (error as Error).message };
  }
};
const structures = [
  structural("repeat-ok", () => {}, { type: "repeat", appearanceId: "verse1", newId: "verse2" }),
  structural("repeat-dup", () => {}, { type: "repeat", appearanceId: "verse1", newId: "verse1" }),
  structural("repeat-bad-id", () => {}, { type: "repeat", appearanceId: "verse1", newId: "??" }),
  structural("move-ok", s => {
    s.tables.arrangement.verse2 = { id: "verse2", name: "Again", sectionId: "verse" };
    s.arrangementOrder.push("verse2");
  }, { type: "move", appearanceId: "verse1", direction: 1 }),
  structural("move-direction", () => {}, { type: "move", appearanceId: "verse1", direction: 2 as unknown as 1 }),
  structural("move-edge", () => {}, { type: "move", appearanceId: "verse1", direction: -1 }),
  structural("move-missing", () => {}, { type: "move", appearanceId: "gone", direction: 1 }),
  structural("remove-ok", () => {}, { type: "remove", appearanceId: "verse1" }),
  structural("attach-ok", s => {
    s.tables.occurrences.g1 = { id: "g1", name: "G", sectionId: null, patternId: "riff", voiceId: "lead", start: [1, 1], span: [1, 1], phase: [0, 1], boundary: "continue", tails: "ring" };
  }, { type: "attach", appearanceId: "verse1", occurrenceId: "g1" }),
  structural("attach-pitched", () => {}, { type: "attach", appearanceId: "verse1", occurrenceId: "lead1" }),
  structural("variation-ok", () => {}, { type: "variation", appearanceId: "verse1", newId: "v2", name: "Again" }, false),
];
const rhythmic = (
  name: string,
  setup: (s: typeof song) => void,
  action: RhythmAction,
) => {
  const input = structuredClone(song);
  setup(input);
  const mutation = { songId: input.id, expectedRevision: 0, operationId: "op", label: "op", command: { kind: "rhythm", action } as const };
  try {
    const envelope = applyCommand({ id: input.id, revision: 0, song: input, updatedAt: 0, history: [] }, mutation, 100);
    return { name, song: input, mutation, ok: true as const, songAfter: envelope.song };
  } catch (error) {
    return { name, song: input, mutation, ok: false as const, error: (error as Error).message };
  }
};
const rhythms = [
  rhythmic("variation-ok", () => {}, { type: "variation", patternId: "riff", newId: "riff2", name: "Again" }),
  rhythmic("variation-dup", () => {}, { type: "variation", patternId: "riff", newId: "riff", name: "Again" }),
  rhythmic("variation-missing", () => {}, { type: "variation", patternId: "gone", newId: "riff2", name: "Again" }),
  rhythmic("displace-ok", s => { s.tables.occurrences.lead1!.span = [1, 1]; }, { type: "displace", occurrenceId: "lead1", amount: [1, 2] }),
  rhythmic("displace-missing", () => {}, { type: "displace", occurrenceId: "gone", amount: [1, 2] }),
  rhythmic("phase-ok", () => {}, { type: "phase", occurrenceId: "lead1", amount: [1, 2] }),
  rhythmic("rotate-ok", () => {}, { type: "rotate", patternId: "riff", amount: [1, 2] }),
  rhythmic("accents-ok", () => {}, { type: "accents", patternId: "riff", steps: 1 }),
  rhythmic("accents-fraction", () => {}, { type: "accents", patternId: "riff", steps: 1.5 }),
  rhythmic("scale-ok", () => {}, { type: "scale", patternId: "riff", factor: [2, 1], releases: "scale", phases: "follow" }),
  rhythmic("scale-policy", () => {}, { type: "scale", patternId: "riff", factor: [2, 1], releases: "stretch" as unknown as "scale", phases: "follow" }),
  rhythmic("scale-factor", () => {}, { type: "scale", patternId: "riff", factor: [0, 1], releases: "scale", phases: "follow" }),
  rhythmic("splice-insert", () => {}, { type: "splice", patternId: "riff", at: [1, 1], amount: [1, 2], mode: "insert", attacks: "reject", phases: "follow" }),
  rhythmic("splice-remove", () => {}, { type: "splice", patternId: "riff", at: [1, 1], amount: [1, 2], mode: "remove", attacks: "delete", phases: "keep" }),
  rhythmic("splice-reject", () => {}, { type: "splice", patternId: "riff", at: [0, 1], amount: [2, 1], mode: "remove", attacks: "reject", phases: "keep" }),
  rhythmic("splice-policy", () => {}, { type: "splice", patternId: "riff", at: [1, 1], amount: [1, 2], mode: "cut" as unknown as "insert", attacks: "reject", phases: "keep" }),
  rhythmic("splice-outside", () => {}, { type: "splice", patternId: "riff", at: [4, 1], amount: [1, 2], mode: "insert", attacks: "reject", phases: "keep" }),
  rhythmic("poly-ok", s => {
    s.tables.parts.bass = { id: "bass", name: "Bass", instrument: "bass", volume: 0.8, muted: false };
    s.tables.voices.bass1 = { id: "bass1", name: "Bass", partId: "bass" };
  }, {
    type: "polyrhythm", newId: "poly", name: "Poly", sectionId: null,
    start: [0, 1], duration: [2, 1], noteDuration: [1, 4],
    lanes: [
      { voiceId: "lead", divisions: 2, pitch: { degree: 1, alteration: 0, octave: 0 }, drum: "kick" },
      { voiceId: "bass1", divisions: 3, pitch: { degree: 3, alteration: 0, octave: 0 }, drum: "hat" },
    ],
  }),
  rhythmic("poly-voices", () => {}, {
    type: "polyrhythm", newId: "poly", name: "Poly", sectionId: null,
    start: [0, 1], duration: [2, 1], noteDuration: [1, 4],
    lanes: [{ voiceId: "lead", divisions: 2, pitch: { degree: 1, alteration: 0, octave: 0 }, drum: "kick" }],
  }),
  rhythmic("poly-divisions", () => {}, {
    type: "polyrhythm", newId: "poly", name: "Poly", sectionId: null,
    start: [0, 1], duration: [2, 1], noteDuration: [1, 4],
    lanes: [
      { voiceId: "lead", divisions: 2, pitch: { degree: 1, alteration: 0, octave: 0 }, drum: "kick" },
      { voiceId: "lead", divisions: 0, pitch: { degree: 3, alteration: 0, octave: 0 }, drum: "hat" },
    ],
  }),
];
const harmonic = (
  name: string,
  setup: (s: typeof song) => void,
  action: HarmonyAction,
) => {
  const input = structuredClone(song);
  setup(input);
  const mutation = { songId: input.id, expectedRevision: 0, operationId: "op", label: "op", command: { kind: "harmony", action } as const };
  try {
    const envelope = applyCommand({ id: input.id, revision: 0, song: input, updatedAt: 0, history: [] }, mutation, 100);
    return { name, song: input, mutation, ok: true as const, songAfter: envelope.song };
  } catch (error) {
    return { name, song: input, mutation, ok: false as const, error: (error as Error).message };
  }
};
const majorTriad: ChordRecipe = {
  root: "I", quality: "major", extension: 0, seventh: "major", tones: [], omit: [],
  inversion: 0, octave: 0, target: null, tonic: { degree: 1, alteration: 0, octave: 0 },
};
const harmonies = [
  harmonic("build-ok", () => {}, { type: "build", newId: "chorus", name: "Chorus", recipe: { ...majorTriad }, eventId: null, performance: "reset" }),
  harmonic("build-event", () => {}, { type: "build", newId: "chorus", name: "Chorus", recipe: { ...majorTriad }, eventId: "harmony", performance: "reset" }),
  harmonic("build-reject", s => {
    s.tables.events.harmony!.performance = [{ memberId: "root", offset: [0, 1], duration: [1, 1] }];
  }, { type: "build", newId: "chorus", name: "Chorus", recipe: { ...majorTriad }, eventId: "harmony", performance: "reject" }),
  harmonic("build-policy", () => {}, { type: "build", newId: "chorus", name: "Chorus", recipe: { ...majorTriad }, eventId: null, performance: "swap" as unknown as "reset" }),
  harmonic("build-recipe", () => {}, { type: "build", newId: "chorus", name: "Chorus", recipe: { ...majorTriad, quality: "mystic" as unknown as "major" }, eventId: null, performance: "reset" }),
  harmonic("transpose-ok", () => {}, { type: "transpose", patternId: "riff", newId: "t", steps: 1, semitones: 2 }),
  harmonic("transpose-fraction", () => {}, { type: "transpose", patternId: "riff", newId: "t", steps: 1.5, semitones: 2 }),
  harmonic("transpose-missing", () => {}, { type: "transpose", patternId: "gone", newId: "t", steps: 1, semitones: 2 }),
  harmonic("voicelead-ok", s => {
    s.tables.chords.second = { id: "second", name: "Second", labelTonic: { degree: 5, alteration: 0, octave: 0 }, label: "V", notes: [{ id: "a", pitch: { degree: 5, alteration: 0, octave: 0 } }, { id: "b", pitch: { degree: 2, alteration: 0, octave: 1 } }] };
  }, { type: "voiceLead", sourceId: "chord", targetId: "second", octaveRadius: 1 }),
  harmonic("voicelead-missing", () => {}, { type: "voiceLead", sourceId: "chord", targetId: "gone", octaveRadius: 1 }),
  harmonic("voicelead-radius", () => {}, { type: "voiceLead", sourceId: "chord", targetId: "chord", octaveRadius: 5 }),
  harmonic("perform-ok", () => {}, { type: "perform", eventId: "harmony", order: ["fifth", "root", "third"], step: [1, 4], duration: null }),
  harmonic("perform-order", () => {}, { type: "perform", eventId: "harmony", order: ["root", "third"], step: [1, 4], duration: null }),
  harmonic("perform-event", () => {}, { type: "perform", eventId: "note", order: ["root"], step: [1, 4], duration: null }),
  harmonic("expression-ok", () => {}, { type: "expression", eventIds: ["note", "harmony"], from: 0.5, to: 1, articulation: "staccato", gate: [1, 2] }),
  harmonic("expression-range", () => {}, { type: "expression", eventIds: ["note"], from: 0, to: 2, articulation: "normal", gate: [1, 1] }),
  harmonic("expression-rest", s => {
    s.tables.events.rest1 = { ...noteEvent("rest1", "riff"), kind: "rest", start: [0, 1], duration: [1, 2] };
  }, { type: "expression", eventIds: ["rest1"], from: 0, to: 1, articulation: "normal", gate: [1, 1] }),
  harmonic("expression-pattern", s => {
    s.tables.patterns.riff2 = { ...s.tables.patterns.riff!, id: "riff2", name: "Again" };
    s.tables.events.e2 = { ...noteEvent("e2", "riff2"), start: [0, 1] };
  }, { type: "expression", eventIds: ["note", "e2"], from: 0, to: 1, articulation: "normal", gate: [1, 1] }),
];
type EditHelper = "change" | "remove" | "combine" | "edit";
const edited = (
  name: string,
  setup: (s: typeof song) => void,
  helper: EditHelper,
  args: unknown,
) => {
  const input = structuredClone(song);
  setup(input);
  const run = (): Change[] => {
    if (helper === "change") return changeNotes(input, args as Parameters<typeof changeNotes>[1]);
    if (helper === "remove") return removeNotes(input, args as Parameters<typeof removeNotes>[1]);
    if (helper === "combine") {
      const c = args as { targets: Parameters<typeof combineNotes>[1]; chordId: string; eventId: string };
      return combineNotes(input, c.targets, c.chordId, c.eventId);
    }
    return args as Change[];
  };
  try {
    const changes = run();
    const mutation = { songId: input.id, expectedRevision: 0, operationId: "op", label: "op", command: { kind: "edit", changes } as const };
    const envelope = applyCommand({ id: input.id, revision: 0, song: input, updatedAt: 0, history: [] }, mutation, 100);
    return { name, song: input, helper, args, ok: true as const, changes, songAfter: envelope.song };
  } catch (error) {
    return { name, song: input, helper, args, ok: false as const, error: (error as Error).message };
  }
};
const edits = [
  edited("change-note", () => {}, "change", [{ eventId: "note", memberId: null, pitch: { degree: 2, alteration: 0, octave: 0 }, start: [1, 2], duration: [1, 1] }]),
  edited("change-member", () => {}, "change", [{ eventId: "harmony", memberId: "root", pitch: { degree: 2, alteration: 0, octave: 0 } }]),
  edited("change-anchor", () => {}, "change", [{ eventId: "harmony", memberId: "root", start: [1, 4] }]),
  edited("change-missing", () => {}, "change", [{ eventId: "gone", memberId: null }]),
  edited("change-chord-note", () => {}, "change", [{ eventId: "harmony", memberId: null }]),
  edited("remove-note", () => {}, "remove", [{ eventId: "note", memberId: null }]),
  edited("remove-member", () => {}, "remove", [{ eventId: "harmony", memberId: "third" }]),
  edited("remove-last", () => {}, "remove", [
    { eventId: "harmony", memberId: "root" },
    { eventId: "harmony", memberId: "third" },
    { eventId: "harmony", memberId: "fifth" },
  ]),
  edited("combine-ok", s => {
    s.tables.events.note2 = { ...noteEvent("note2", "riff"), start: [2, 1], pitch: { degree: 3, alteration: 0, octave: 0 } };
  }, "combine", { targets: [{ eventId: "note", memberId: null }, { eventId: "note2", memberId: null }], chordId: "combined", eventId: "chord2" }),
  edited("combine-member", () => {}, "combine", { targets: [{ eventId: "harmony", memberId: "root" }], chordId: "combined", eventId: "chord2" }),
  edited("combine-pattern", s => {
    s.tables.patterns.riff2 = { ...s.tables.patterns.riff!, id: "riff2", name: "Again" };
    s.tables.events.e2 = { ...noteEvent("e2", "riff2"), start: [0, 1] };
  }, "combine", { targets: [{ eventId: "note", memberId: null }, { eventId: "e2", memberId: null }], chordId: "combined", eventId: "chord2" }),
  edited("combine-expression", s => {
    s.tables.events.note2 = { ...noteEvent("note2", "riff"), start: [2, 1], accent: 0.9 };
  }, "combine", { targets: [{ eventId: "note", memberId: null }, { eventId: "note2", memberId: null }], chordId: "combined", eventId: "chord2" }),
  edited("meta-title", () => {}, "edit", [{ table: "meta", id: "title", value: "Retitled" }]),
  edited("meta-bad", () => {}, "edit", [{ table: "meta", id: "owner", value: "x" }]),
  edited("table-unknown", () => {}, "edit", [{ table: "nope", id: "x", value: {} }]),
  edited("table-proto", () => {}, "edit", [{ table: "events", id: "__proto__", value: null }]),
  edited("delete-event", () => {}, "edit", [{ table: "events", id: "note", value: null }]),
];
const analyzed = () => {
  const input = structuredClone(song);
  input.tables.parts.bass = { id: "bass", name: "Bass", instrument: "bass", volume: 0.8, muted: false };
  input.tables.voices.bass1 = { id: "bass1", name: "Bass", partId: "bass" };
  input.tables.phrases.ph1 = { id: "ph1", name: "Phrase", sectionId: "verse", start: [0, 1], duration: [2, 1] };
  input.tables.lyrics.ly1 = { id: "ly1", name: "Lyric", sectionId: "verse", start: [0, 1], duration: [1, 1], text: "la", phraseId: "ph1", partId: null };
  input.tables.patterns.riff2 = { ...input.tables.patterns.riff!, id: "riff2", name: "Again" };
  input.tables.events.e1 = { ...input.tables.events.note!, id: "e1", patternId: "riff2", start: [2, 3] };
  input.tables.occurrences.lead2 = { ...input.tables.occurrences.lead1!, id: "lead2", name: "Second", start: [7, 2], span: [5, 1] };
  input.tables.occurrences.bass1o = { id: "bass1o", name: "Bass", sectionId: "verse", patternId: "riff", voiceId: "bass1", start: [0, 1], span: [2, 1], phase: [0, 1], boundary: "continue", tails: "ring" };
  input.tables.polyrhythms.p1 = {
    id: "p1", name: "Poly", sectionId: "verse", start: [0, 1], duration: [2, 1],
    lanes: [{ occurrenceId: "lead1", divisions: 2 }, { occurrenceId: "bass1o", divisions: 2 }],
  };
  input.tables.harmony.h0 = { id: "h0", name: "Global", sectionId: null, start: [0, 1], duration: [1, 1], tonic: { degree: 1, alteration: 0, octave: 0 }, mode: "major", annotation: "home" };
  input.tables.harmony.h1 = { id: "h1", name: "Verse", sectionId: "verse", start: [0, 1], duration: [4, 1], tonic: { degree: 1, alteration: 0, octave: 0 }, mode: "major", annotation: "I" };
  input.tables.harmony.h2 = { id: "h2", name: "Later", sectionId: "verse", start: [4, 1], duration: [4, 1], tonic: { degree: 5, alteration: 0, octave: 0 }, mode: "major", annotation: "V" };
  const attempt = (fn: () => unknown) => {
    try { return { ok: true as const, value: fn() }; }
    catch (error) { return { ok: false as const, error: (error as Error).message }; }
  };
  const until = songEnd(input);
  const chordNotes = input.tables.chords.chord!.notes.map(n => n.pitch);
  const many = Array.from({ length: 65 }, () => ({ degree: 1, alteration: 0, octave: 0 }));
  return {
    name: "analysis",
    song: input,
    annotations: attempt(() => annotations(input)),
    alignment: attempt(() => alignmentMap(input, ["lead1", "lead2"], [0, 1], until)),
    alignmentSingle: attempt(() => alignmentMap(input, ["lead1"], [0, 1], until)),
    alignmentUnknown: attempt(() => alignmentMap(input, ["lead1", "gone"], [0, 1], until)),
    alignmentRange: attempt(() => alignmentMap(input, ["lead1", "lead2"], [2, 1], [1, 1])),
    alignmentMany: attempt(() => alignmentMap(input, ["a", "b", "c", "d", "e", "f", "g", "h", "i"], [0, 1], until)),
    grid: attempt(() => polyrhythmGrid(input, "p1")),
    gridUnknown: attempt(() => polyrhythmGrid(input, "gone")),
    compare: attempt(() => comparePatterns(input, "riff", "riff2")),
    compareUnknown: attempt(() => comparePatterns(input, "riff", "gone")),
    harmony: {
      spans: attempt(() => harmonicSpans(input)),
      contextEarly: attempt(() => harmonicContext(input, [0, 1])),
      contextLater: attempt(() => harmonicContext(input, [5, 1])),
      contextEmpty: attempt(() => harmonicContext(input, [8, 1])),
      contextNegative: attempt(() => harmonicContext(input, [-1, 1])),
      interpretChord: attempt(() => interpretations(chordNotes, { degree: 1, alteration: 0, octave: 0 }, "major")),
      interpretInvalid: attempt(() => interpretations([{ degree: 8, alteration: 0, octave: 0 }], { degree: 1, alteration: 0, octave: 0 }, "major")),
      interpretMany: attempt(() => interpretations(many, { degree: 1, alteration: 0, octave: 0 }, "major")),
      candidates: attempt(() => chordCandidates(input, "chord")),
      candidatesUnknown: attempt(() => chordCandidates(input, "gone")),
      soundingEarly: attempt(() => soundingHarmony(input, [1, 1])),
      soundingEmpty: attempt(() => soundingHarmony(input, [8, 1])),
    },
  };
};
const tabulated = () => {
  const input = structuredClone(song);
  input.tables.fretted.tab1 = { id: "tab1", name: "Tab", partId: "guitar", tonic: 40, tuning: [64, 59, 55, 50, 45, 40], capo: 0, maxFret: 12, handSpan: 4 };
  input.tables.fingerings.f1 = { id: "f1", name: "F1", arrangementId: "tab1", occurrenceId: "lead1", eventId: "harmony", memberId: "root", string: 1, fret: 0, technique: "pluck", fromId: null };
  input.tables.fingerings.f2 = { id: "f2", name: "F2", arrangementId: "tab1", occurrenceId: "lead1", eventId: "gone", memberId: null, string: 2, fret: 3, technique: "tap", fromId: null };
  input.tables.takes.take1 = { id: "take1", name: "Take", assetId: "a1", partId: "guitar", sectionId: "verse", start: [0, 1], offset: 0, duration: 2, gain: 0.8, muted: false };
  input.tables.takes.take2 = { id: "take2", name: "Take", assetId: "a1", partId: "guitar", sectionId: null, start: [1, 1], offset: 0, duration: 1, gain: 1, muted: true };
  const attempt = (fn: () => unknown) => {
    try { return { ok: true as const, value: fn() }; }
    catch (error) { return { ok: false as const, error: (error as Error).message }; }
  };
  const f1 = input.tables.fingerings.f1!;
  const arrangement = input.tables.fretted.tab1!;
  return {
    name: "tabtakes",
    song: input,
    tab: attempt(() => tablature(input, "tab1", [0, 1], [17, 2])),
    tabUnknown: attempt(() => tablature(input, "gone", [0, 1], [17, 2])),
    tabRange: attempt(() => tablature(input, "tab1", [2, 1], [1, 1])),
    positions: attempt(() => fretPositions(input, "tab1", "lead1", "harmony", "root")),
    positionsUnknown: attempt(() => fretPositions(input, "gone", "lead1", "harmony", "root")),
    target: attempt(() => targetPitch(input, arrangement, "lead1", "harmony", "root")),
    targetStale: attempt(() => targetPitch(input, arrangement, "lead1", "gone", null)),
    issues: attempt(() => fingeringIssues(input, f1)),
    placements: attempt(() => takePlacements(input)),
  };
};
const analysis = [analyzed(), tabulated()];
const migrated: { name: string; table?: string; input: unknown; output: unknown }[] = [
  { name: "chord-missing-tonic", table: "chords", input: { id: "c", name: "C", notes: [{ id: "n", pitch: { degree: 1, alteration: 0, octave: 0 } }], label: null } },
  { name: "section-missing-source", table: "sections", input: { id: "s", name: "S", barIds: [] } },
  { name: "occurrence-missing-scope", table: "occurrences", input: { id: "o", name: "O", patternId: "p", voiceId: "v", start: [0, 1], span: [1, 1], phase: [0, 1], boundary: "continue", tails: "ring" } },
  { name: "pattern-missing-groups", table: "patterns", input: { id: "p", name: "P", length: [4, 1], sourceId: null } },
  { name: "event-missing-origin", table: "events", input: { id: "e", name: "E", patternId: "p", kind: "note", start: [0, 1], duration: [1, 1], pitch: { degree: 1, alteration: 0, octave: 0 }, chordId: null, drum: "kick", accent: 0.5, articulation: "normal", performance: [] } },
  { name: "non-record", table: "events", input: "hello" },
  { name: "unknown-table", table: "takes", input: { a: 1 } },
].map(({ name, table, input }) => ({ name, table, input, output: migrateEntity(table, input) }));
const oldSong = {
  schemaVersion: 5, id: "old", title: "Old", mode: "major", degreeReference: "major",
  tempo: { bpm: 100, beatUnit: [1, 1] }, arrangementOrder: [], writing: { instructions: "", preferences: "" },
  tables: {
    patterns: { p: { id: "p", name: "P", length: [4, 1], sourceId: null } },
    events: {}, chords: {}, bars: {}, sections: {}, arrangement: {}, parts: {}, voices: {},
    occurrences: {}, prompts: {}, markers: {},
  },
};
migrated.push(
  { name: "song-v5", input: oldSong, output: migrateSong(oldSong) },
  { name: "song-v7-passthrough", input: song, output: migrateSong(song) },
  { name: "song-v8-passthrough", input: { ...structuredClone(song), schemaVersion: 8 }, output: migrateSong({ ...structuredClone(song), schemaVersion: 8 }) },
  { name: "song-missing-tables", input: { schemaVersion: 5, id: "x" }, output: migrateSong({ schemaVersion: 5, id: "x" }) },
  { name: "song-non-record", input: [1, 2], output: migrateSong([1, 2]) },
);
const imported = (() => {
  let current = { id: song.id, revision: 0, song: structuredClone(song), updatedAt: 0, history: [] as never[] };
  const dispatch = (operationId: string, command: Mutation["command"]) => {
    current = applyCommand(current, { songId: song.id, expectedRevision: current.revision, operationId, label: operationId, command }, current.revision + 1) as typeof current;
  };
  dispatch("rename", { kind: "edit", changes: [{ table: "meta", id: "title", value: "Imported" }] });
  dispatch("remove", { kind: "delete" });
  dispatch("restore", { kind: "undo", targetId: "remove" });
  return { id: current.id, revision: current.revision, song: current.song, updatedAt: 0, history: current.history };
})();
for (const [name, data] of Object.entries({ "fixture.json": song, "commands.json": cases, "time.json": times, "audio.json": audio, "timeline.json": timeline, "validate.json": validateCases, "history.json": history, "structure.json": structures, "rhythm.json": rhythms, "harmony.json": harmonies, "edit.json": edits, "analysis.json": analysis, "migrate.json": migrated, "import.json": imported })) {
  const path = new URL(`../../tests/desktop/${name}`, import.meta.url);
  const content = JSON.stringify(data, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== content) throw new Error(`Stale Rust migration reference: ${name}`);
  } else writeFileSync(path, content);
}
console.log(`Verified TypeScript reference: ${cases.length} command steps ${times.length} exact-time cases and ${audio.length} audio cases.`);
