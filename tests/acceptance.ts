import { emptySong, noteEvent, type Song } from "../src/song/model.ts";
// Editable test fixture. The agent acceptance is authored separately through live tools.
export function acceptance(id = "acceptance"): Song {
  const s = emptySong(id, "Seven meets eight");
  const t = s.tables;
  for (const [id, name, instrument] of [
    ["guitar", "Guitar", "guitar"],
    ["bass", "Bass", "bass"],
    ["drums", "Drums", "drums"],
  ] as const) {
    t.parts[id] = { id, name, instrument, volume: 0.6, muted: false };
    t.voices[id] = { id, name: "Main voice", partId: id };
  }
  t.voices.high = { id: "high", name: "Upper voice", partId: "guitar" };
  t.patterns.seven = {
    id: "seven",
    name: "Seven steps",
    length: [7, 2],
    groups: [],
    sourceId: null,
  };
  t.patterns.eight = {
    id: "eight",
    name: "Steady eight",
    length: [4, 1],
    groups: [],
    sourceId: null,
  };
  t.patterns.bass = {
    id: "bass",
    name: "Pedal",
    length: [32, 1],
    groups: [],
    sourceId: null,
  };
  t.chords.tonic = {
    id: "tonic",
    name: "Open tonic",
    labelTonic: { degree: 1, alteration: 0, octave: 0 },
    label: "I",
    notes: [
      { id: "root", pitch: { degree: 1, alteration: 0, octave: 0 } },
      { id: "third", pitch: { degree: 3, alteration: 0, octave: 1 } },
      { id: "fifth", pitch: { degree: 5, alteration: 0, octave: 0 } },
    ],
  };
  t.events.chord = {
    ...noteEvent("chord", "seven"),
    name: "Ringing tonic",
    kind: "chord",
    chordId: "tonic",
    duration: [4, 1],
    performance: [{ memberId: "third", offset: [1, 2], duration: [1, 1] }],
  };
  t.events.melody = {
    ...noteEvent("melody", "seven"),
    name: "Passing note",
    start: [3, 2],
    pitch: { degree: 2, alteration: 0, octave: 1 },
  };
  t.events.rest = {
    ...noteEvent("rest", "seven"),
    name: "Breathe",
    kind: "rest",
    start: [3, 1],
  };
  t.events.pedal = {
    ...noteEvent("pedal", "bass"),
    name: "Low pedal",
    duration: [30, 1],
    pitch: { degree: 1, alteration: 0, octave: -1 },
    articulation: "sustain",
  };
  for (let i = 0; i < 8; i++) {
    const id = `hit-${i}`;
    t.events[id] = {
      ...noteEvent(id, "eight"),
      name: `Hit ${i + 1}`,
      kind: "drum",
      start: [i, 2],
      drum: i % 4 === 0 ? "kick" : i % 4 === 2 ? "snare" : "hat",
      accent: i % 4 === 0 ? 1 : 0.5,
    };
    if (i % 2 === 0) t.events[id]!.start = [i / 2, 1];
  }
  for (const [id, patternId, voiceId] of [
    ["guitar", "seven", "guitar"],
    ["drums", "eight", "drums"],
    ["bass", "bass", "bass"],
  ] as const)
    t.occurrences[id] = {
      id,
      name: t.patterns[patternId]!.name,
      patternId,
      voiceId,
      start: [0, 1],
      span: [32, 1],
      phase: [0, 1],
      sectionId: null,
      boundary: "continue",
      tails: "ring",
    };
  t.sections.verse = { sourceId: null, id: "verse", name: "Verse", barIds: [] };
  t.sections.turn = { sourceId: null, id: "turn", name: "Turn", barIds: [] };
  for (let i = 0; i < 8; i++) {
    const id = `bar-${i}`,
      sec = i < 4 ? "verse" : "turn";
    t.sections[sec]!.barIds.push(id);
    t.bars[id] = {
      id,
      name: `Bar ${i + 1}`,
      sectionId: sec,
      numerator: i === 4 ? 7 : i === 5 ? 9 : 4,
      denominator: i === 4 || i === 5 ? 8 : 4,
      groups: i === 4 ? [2, 2, 3] : i === 5 ? [3, 3, 3] : [1, 1, 1, 1],
      actual: null,
    };
  }
  for (const id of ["verse", "turn"])
    t.arrangement[id] = { id, name: id, sectionId: id };
  s.arrangementOrder = ["verse", "turn"];
  return s;
}
