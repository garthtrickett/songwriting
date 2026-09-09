// The existing TypeScript implementation is the migration reference, not a
// runtime dependency of the Rust workspace. Regenerate deliberately; CI checks drift.
import { sounds } from "../../src/song/timeline.ts";
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
const audio = ["baseline", "member-offsets", "cut-tails", "repeated-section", "muted"].map(name => {
  const input = structuredClone(song);
  if (name !== "baseline") input.tables.events.harmony!.performance = [
    { memberId: "root", offset: time(1, 3), duration: time(2, 1) },
    { memberId: "fifth", offset: time(1, 1), duration: time(3, 1) },
  ];
  if (name === "cut-tails") input.tables.occurrences.lead1!.tails = "cut";
  if (name === "muted") input.tables.parts.guitar!.muted = true;
  if (name === "repeated-section") {
    input.tables.arrangement.verse2 = { id: "verse2", name: "Again", sectionId: "verse" };
    input.arrangementOrder.push("verse2");
  }
  return { name, song: input, notes: sounds(input).map(n => ({ start:n.start, duration:n.duration, frequency:440 * 2 ** ((60 + semitone(n.pitch!) - 69) / 12), gain:n.gain * 0.1 })) };
});
for (const [name, data] of Object.entries({ "fixture.json": song, "commands.json": cases, "time.json": times, "audio.json": audio })) {
  const path = new URL(`../../tests/desktop/${name}`, import.meta.url);
  const content = JSON.stringify(data, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== content) throw new Error(`Stale Rust migration reference: ${name}`);
  } else writeFileSync(path, content);
}
console.log(`Verified TypeScript reference: ${cases.length} command steps ${times.length} exact-time cases and ${audio.length} audio cases.`);
