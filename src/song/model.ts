import type { Time } from "./time.ts";
export interface Entity {
  id: string;
  name: string;
}
export interface Pitch {
  degree: number;
  alteration: number;
  octave: number;
}
export interface Note {
  id: string;
  pitch: Pitch;
}
export interface Part extends Entity {
  instrument: "guitar" | "bass" | "drums";
  volume: number;
  muted: boolean;
}
export interface Voice extends Entity {
  partId: string;
}
export interface Pattern extends Entity {
  groups: Time[];
  length: Time;
  sourceId: string | null;
}
export interface Chord extends Entity {
  labelTonic: Pitch;
  notes: Note[];
  label: string | null;
}
export type Articulation =
  "normal" | "staccato" | "sustain" | "muted" | "ghost";
export interface Performance {
  gain?: number;
  articulation?: Articulation | "inherit";
  memberId: string;
  offset: Time;
  duration: Time;
}
export interface MusicalEvent extends Entity {
  originId: string;
  patternId: string;
  kind: "note" | "chord" | "drum" | "rest";
  start: Time;
  duration: Time;
  pitch: Pitch;
  chordId: string | null;
  drum: "kick" | "snare" | "hat";
  accent: number;
  articulation: Articulation;
  performance: Performance[];
}
export interface Bar extends Entity {
  sectionId: string;
  numerator: number;
  denominator: number;
  groups: number[];
  actual: Time | null;
}
export interface Section extends Entity {
  sourceId: string | null;
  barIds: string[];
}
export interface SectionOccurrence extends Entity {
  sectionId: string;
}
export interface Occurrence extends Entity {
  sectionId: string | null;
  patternId: string;
  voiceId: string;
  start: Time;
  span: Time;
  phase: Time;
  boundary: "continue" | "restart" | "stop";
  tails: "ring" | "cut";
}
export interface Marker extends Entity {
  at: Time;
}
export interface Phrase extends Entity {
  sectionId: string;
  start: Time;
  duration: Time;
}
export interface Lyric extends Phrase {
  text: string;
  phraseId: string | null;
  partId: string | null;
}
export interface Polyrhythm extends Entity {
  sectionId: string | null;
  start: Time;
  duration: Time;
  lanes: { occurrenceId: string; divisions: number }[];
}
export interface HarmonicRegion extends Entity {
  sectionId: string | null;
  start: Time;
  duration: Time;
  tonic: Pitch;
  mode: string;
  annotation: string;
}
export interface Tables {
  harmony: Record<string, HarmonicRegion>;
  parts: Record<string, Part>;
  voices: Record<string, Voice>;
  patterns: Record<string, Pattern>;
  chords: Record<string, Chord>;
  events: Record<string, MusicalEvent>;
  bars: Record<string, Bar>;
  sections: Record<string, Section>;
  arrangement: Record<string, SectionOccurrence>;
  occurrences: Record<string, Occurrence>;
  markers: Record<string, Marker>;
  phrases: Record<string, Phrase>;
  lyrics: Record<string, Lyric>;
  polyrhythms: Record<string, Polyrhythm>;
}
export const TABLES = [
  "harmony",
  "parts",
  "voices",
  "patterns",
  "chords",
  "events",
  "bars",
  "sections",
  "arrangement",
  "occurrences",
  "markers",
  "phrases",
  "lyrics",
  "polyrhythms",
] as const;
export type Table = (typeof TABLES)[number];
export interface Song {
  schemaVersion: 4;
  id: string;
  title: string;
  mode: string;
  degreeReference: "major";
  tempo: { bpm: number; beatUnit: Time };
  arrangementOrder: string[];
  tables: Tables;
}
export const emptySong = (id: string, title = "Untitled idea"): Song => ({
  schemaVersion: 4,
  id,
  title,
  mode: "major",
  degreeReference: "major",
  tempo: { bpm: 112, beatUnit: [1, 1] },
  arrangementOrder: [],
  tables: {
    harmony: {},
    parts: {},
    voices: {},
    patterns: {},
    chords: {},
    events: {},
    bars: {},
    sections: {},
    arrangement: {},
    occurrences: {},
    markers: {},
    phrases: {},
    lyrics: {},
    polyrhythms: {},
  },
});
export const noteEvent = (id: string, patternId: string): MusicalEvent => ({
  id,
  name: "Note",
  originId: id,
  patternId,
  kind: "note",
  start: [0, 1],
  duration: [1, 2],
  pitch: { degree: 1, alteration: 0, octave: 0 },
  chordId: null,
  drum: "kick",
  accent: 0.7,
  articulation: "normal",
  performance: [],
});
export const pitchLabel = (p: Pitch) =>
  `${p.alteration < 0 ? "♭".repeat(-p.alteration) : "♯".repeat(p.alteration)}${p.degree}${p.octave === 0 ? "" : p.octave > 0 ? `↑${p.octave}` : `↓${-p.octave}`}`;
export const semitone = (p: Pitch) =>
  [0, 2, 4, 5, 7, 9, 11][p.degree - 1]! + p.alteration + 12 * p.octave;
