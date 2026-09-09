// The existing TypeScript implementation is the migration reference, not a
// runtime dependency of the Rust workspace. Regenerate deliberately; CI checks drift.
import { sounds, bars, songEnd, segments, alignment, secondsPerQuarter, clicks, cycleStarts, restSpans } from "../../src/song/timeline.ts";
import { placements } from "../../src/song/arrangement.ts";
import { emptySong, noteEvent, semitone } from "../../src/song/model.ts";
import { applyCommand, difference, type Envelope, type Mutation } from "../../src/song/commands.ts";
import { changeNotes } from "../../src/song/note-edit.ts";
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
const cases = requests.map((r, index) => {
  const a = r.action;
  const before = structuredClone(current.song);
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
    return { request: r, ok: true, changes: difference(before, current.song), revision: current.revision };
  } catch (error) {
    return { request: r, ok: false, error: (error as Error).message, changes: difference(before, current.song), revision: current.revision };
  }
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
  return { name, song: input, notes: sounds(input).map(n => ({ start:n.start, duration:n.duration, frequency:440 * 2 ** ((60 + semitone(n.pitch!) - 69) / 12), gain:n.gain * 0.1 })) };
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
  broken("perf-articulation", s => { s.tables.events.harmony!.performance = [{ memberId: "root", offset: [0, 1], duration: [1, 1], articulation: "wild" }]; }),
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
    const g = { id: "g1", name: "G", arrangementId: "f1", occurrenceId: "lead1", eventId: "note", memberId: null, string: 1, fret: 0, technique: "pluck", fromId: null };
    s.tables.fingerings.g1 = g;
    s.tables.fingerings.g2 = { ...g, id: "g2", name: "G2" };
  }),
  broken("marker-negative", s => { s.tables.markers.m1 = { id: "m1", name: "M", at: [-1, 1] }; }),
];
for (const [name, data] of Object.entries({ "fixture.json": song, "commands.json": cases, "time.json": times, "audio.json": audio, "timeline.json": timeline, "validate.json": validateCases })) {
  const path = new URL(`../../tests/desktop/${name}`, import.meta.url);
  const content = JSON.stringify(data, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== content) throw new Error(`Stale Rust migration reference: ${name}`);
  } else writeFileSync(path, content);
}
console.log(`Verified TypeScript reference: ${cases.length} command steps ${times.length} exact-time cases and ${audio.length} audio cases.`);
