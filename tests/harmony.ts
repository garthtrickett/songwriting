import { type ChordRecipe } from "../src/song/chord-builder.ts";
import { TONIC } from "../src/song/harmony-pitch.ts";
import { arrangementSong } from "./arrangement.ts";
export const recipe = (patch: Partial<ChordRecipe> = {}): ChordRecipe => ({
  root: "I",
  quality: "major",
  extension: 0,
  seventh: "minor",
  tones: [],
  omit: [],
  inversion: 0,
  octave: 0,
  target: null,
  tonic: { ...TONIC },
  ...patch,
});
export function harmonySong(id = "harmony-test") {
  const s = arrangementSong(id);
  s.tables.harmony.global = {
    id: "global",
    name: "Song context",
    sectionId: null,
    start: [0, 1],
    duration: [32, 1],
    tonic: { ...TONIC },
    mode: "major",
    annotation: "Held home",
  };
  s.tables.harmony.local = {
    id: "local",
    name: "Dominant centre",
    sectionId: "verse",
    start: [4, 1],
    duration: [4, 1],
    tonic: { degree: 5, alteration: 0, octave: 0 },
    mode: "mixolydian",
    annotation: "Temporary focus",
  };
  return s;
}
