import { emptySong, noteEvent, type Fingering } from "../src/song/model.ts";
export function frettedSong(id = "fretted-song") {
  const s = emptySong(id, "Strings in conversation"),
    t = s.tables;
  t.parts.guitar = {
    id: "guitar",
    name: "Guitar",
    instrument: "guitar",
    volume: 0.6,
    muted: false,
  };
  t.voices.melody = { id: "melody", name: "Tapping melody", partId: "guitar" };
  t.voices.pedal = { id: "pedal", name: "Held low voice", partId: "guitar" };
  t.patterns.riff = {
    id: "riff",
    name: "Melody",
    length: [4, 1],
    groups: [],
    sourceId: null,
  };
  t.patterns.hold = {
    id: "hold",
    name: "Pedal",
    length: [8, 1],
    groups: [],
    sourceId: null,
  };
  t.events.first = {
    ...noteEvent("first", "riff"),
    name: "First tap",
    pitch: { degree: 1, alteration: 0, octave: 1 },
    duration: [2, 1],
  };
  t.events.second = {
    ...noteEvent("second", "riff"),
    name: "Hammer target",
    pitch: { degree: 2, alteration: 0, octave: 1 },
    start: [1, 3],
    duration: [1, 1],
  };
  t.events.held = {
    ...noteEvent("held", "hold"),
    name: "Held D",
    pitch: { degree: 1, alteration: 0, octave: 0 },
    duration: [8, 1],
    articulation: "sustain",
  };
  t.sections.a = {
    id: "a",
    name: "A",
    sourceId: null,
    barIds: ["seven", "nine"],
  };
  t.bars.seven = {
    id: "seven",
    name: "7/8",
    sectionId: "a",
    numerator: 7,
    denominator: 8,
    groups: [2, 2, 3],
    actual: null,
  };
  t.bars.nine = {
    id: "nine",
    name: "9/8",
    sectionId: "a",
    numerator: 9,
    denominator: 8,
    groups: [3, 3, 3],
    actual: null,
  };
  t.arrangement.a = { id: "a", name: "A", sectionId: "a" };
  s.arrangementOrder = ["a"];
  t.occurrences.line = {
    id: "line",
    name: "Melody placement",
    sectionId: "a",
    patternId: "riff",
    voiceId: "melody",
    start: [0, 1],
    span: [8, 1],
    phase: [0, 1],
    boundary: "continue",
    tails: "ring",
  };
  t.occurrences.bass = {
    id: "bass",
    name: "Pedal placement",
    sectionId: null,
    patternId: "hold",
    voiceId: "pedal",
    start: [0, 1],
    span: [8, 1],
    phase: [0, 1],
    boundary: "continue",
    tails: "ring",
  };
  t.fretted.drop = {
    id: "drop",
    name: "Drop D",
    partId: "guitar",
    tonic: 50,
    tuning: [64, 59, 55, 50, 45, 38],
    capo: 0,
    maxFret: 24,
    handSpan: 4,
  };
  return s;
}
export const finger = (
  id: string,
  eventId = "first",
  patch: Partial<Fingering> = {},
): Fingering => ({
  id,
  name: id,
  arrangementId: "drop",
  occurrenceId: "line",
  eventId,
  memberId: null,
  string: 2,
  fret: 3,
  technique: "tap",
  fromId: null,
  ...patch,
});
