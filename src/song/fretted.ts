import {
  TECHNIQUES,
  semitone,
  type Song,
  type Fretted,
  type Fingering,
  type Pitch,
} from "./model.ts";
export const TUNINGS = {
  "Standard guitar": [64, 59, 55, 50, 45, 40],
  "Drop D": [64, 59, 55, 50, 45, 38],
  DADGAD: [62, 57, 55, 50, 45, 38],
  "Standard bass": [43, 38, 33, 28],
  "Five-string bass": [43, 38, 33, 28, 23],
};
export const connected = (f: Fingering) =>
  ["hammer-on", "pull-off", "slide"].includes(f.technique);
const integer = (v: number, lo: number, hi: number) =>
  Number.isSafeInteger(v) && v >= lo && v <= hi;
const id = (v: unknown) =>
  typeof v === "string" &&
  /^[a-zA-Z0-9_-]{1,100}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
export function validateFretted(s: Song) {
  for (const a of Object.values(s.tables.fretted)) {
    const part = s.tables.parts[a.partId];
    if (!part || !["guitar", "bass"].includes(part.instrument))
      throw new Error("Fretted arrangement needs a guitar/bass part");
    if (
      !integer(a.tonic, 0, 127) ||
      !Array.isArray(a.tuning) ||
      !a.tuning.length ||
      a.tuning.length > 12 ||
      !a.tuning.every((n) => integer(n, 0, 127)) ||
      !integer(a.capo, 0, 24) ||
      !integer(a.maxFret, a.capo, 36) ||
      !integer(a.handSpan, 1, 12)
    )
      throw new Error("Invalid tuning, tonic, capo, last fret or hand span");
  }
  const targets = new Set<string>();
  for (const f of Object.values(s.tables.fingerings)) {
    if (
      !Object.hasOwn(s.tables.fretted, f.arrangementId) ||
      !id(f.occurrenceId) ||
      !id(f.eventId) ||
      !(f.memberId === null || id(f.memberId)) ||
      !(f.fromId === null || id(f.fromId)) ||
      !integer(f.string, 1, 12) ||
      !integer(f.fret, 0, 36) ||
      !TECHNIQUES.includes(f.technique)
    )
      throw new Error("Invalid fingering shape or arrangement reference");
    const key = JSON.stringify([
      f.arrangementId,
      f.occurrenceId,
      f.eventId,
      f.memberId,
    ]);
    if (targets.has(key))
      throw new Error("One fingering per arrangement/placement/note");
    targets.add(key);
  }
}
export function targetPitch(
  s: Song,
  a: Fretted,
  occurrenceId: string,
  eventId: string,
  memberId: string | null,
): Pitch {
  const o = s.tables.occurrences[occurrenceId],
    e = s.tables.events[eventId];
  if (
    !o ||
    !e ||
    o.patternId !== e.patternId ||
    s.tables.voices[o.voiceId]?.partId !== a.partId
  )
    throw new Error("Stale placement/event or different part");
  if (e.kind === "note" && memberId === null) return e.pitch;
  if (e.kind === "chord") {
    const n = s.tables.chords[e.chordId!]?.notes.find((n) => n.id === memberId);
    if (n) return n.pitch;
  }
  throw new Error("Stale or non-pitched note/member target");
}
export function fretPositions(
  s: Song,
  arrangementId: string,
  occurrenceId: string,
  eventId: string,
  memberId: string | null,
) {
  const a = s.tables.fretted[arrangementId];
  if (!a) throw new Error("Unknown fretted arrangement");
  const pitch = targetPitch(s, a, occurrenceId, eventId, memberId),
    midi = a.tonic + semitone(pitch);
  const positions = a.tuning.flatMap((open, i) => {
    const fret = midi - open - a.capo;
    return integer(midi, 0, 127) && integer(fret, 0, a.maxFret - a.capo)
      ? [{ string: i + 1, fret, physicalFret: fret + a.capo }]
      : [];
  });
  return { pitch, midi, positions, unplayable: positions.length === 0 };
}
export function fingeringIssues(s: Song, f: Fingering): string[] {
  const a = s.tables.fretted[f.arrangementId]!;
  const issues: string[] = [];
  try {
    const r = fretPositions(s, a.id, f.occurrenceId, f.eventId, f.memberId);
    if (!r.positions.some((p) => p.string === f.string && p.fret === f.fret))
      issues.push(
        "String/fret does not sound the current note in this tuning/key",
      );
  } catch (e) {
    issues.push(String(e));
  }
  if (f.string > a.tuning.length || f.fret + a.capo > a.maxFret)
    issues.push("Position outside this instrument");
  if (connected(f)) {
    const source = s.tables.fingerings[f.fromId ?? ""];
    if (
      !source ||
      source.id === f.id ||
      source.arrangementId !== a.id ||
      source.string !== f.string ||
      s.tables.occurrences[source.occurrenceId]?.voiceId !==
        s.tables.occurrences[f.occurrenceId]?.voiceId
    )
      issues.push(
        "Connected technique needs another source in the same arrangement, string and voice",
      );
    else if (
      (f.technique === "hammer-on" && f.fret <= source.fret) ||
      (f.technique === "pull-off" && f.fret >= source.fret) ||
      (f.technique === "slide" && f.fret === source.fret)
    )
      issues.push("Technique has incompatible fret direction");
  } else if (f.fromId !== null)
    issues.push("Only a connected technique uses a source");
  return issues;
}
