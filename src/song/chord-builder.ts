import { type Chord, type Pitch, semitone } from "./model.ts";
import {
  shiftPitch,
  romanRoot,
  romanPitch,
  checkedPitch,
} from "./harmony-pitch.ts";
export const QUALITIES = [
  "major",
  "minor",
  "diminished",
  "augmented",
  "sus2",
  "sus4",
  "power",
] as const;
export interface ChordRecipe {
  root: string;
  quality: (typeof QUALITIES)[number];
  extension: 0 | 6 | 7 | 9 | 11 | 13;
  seventh: "major" | "minor" | "diminished";
  tones: { degree: number; alteration: number }[];
  omit: number[];
  inversion: number;
  octave: number;
  target: string | null;
  tonic: Pitch;
}
export function buildChord(id: string, name: string, r: ChordRecipe): Chord {
  if (
    !r ||
    !QUALITIES.includes(r.quality) ||
    ![0, 6, 7, 9, 11, 13].includes(r.extension) ||
    !["major", "minor", "diminished"].includes(r.seventh)
  )
    throw new Error("Choose chord quality, extension and seventh quality");
  if (
    r.extension >= 7 &&
    r.seventh === "diminished" &&
    r.quality !== "diminished"
  )
    throw new Error(
      "Diminished sevenths require diminished quality; use an added sixth for other qualities",
    );
  checkedPitch(r.tonic);
  if (
    !Array.isArray(r.tones) ||
    r.tones.length > 13 ||
    !Array.isArray(r.omit) ||
    r.omit.length > 13 ||
    new Set(r.omit).size !== r.omit.length ||
    !r.omit.every((n) => Number.isInteger(n) && n >= 1 && n <= 13) ||
    !Number.isInteger(r.octave) ||
    Math.abs(r.octave) > 4
  )
    throw new Error("Invalid chord tones, omissions or octave");
  const root = romanRoot(r.root),
    target = r.target === null ? null : romanRoot(r.target);
  const base = target
    ? shiftPitch(r.tonic, target.degree - 1, semitone(target))
    : r.tonic;
  const pitch = shiftPitch(
    base,
    root.degree - 1 + 7 * r.octave,
    semitone(root) + 12 * r.octave,
  );
  const thirds = {
    major: 4,
    minor: 3,
    diminished: 3,
    augmented: 4,
    sus2: 2,
    sus4: 5,
    power: 0,
  };
  const toneMap = new Map<number, number>([
    [1, 0],
    [5, r.quality === "diminished" ? 6 : r.quality === "augmented" ? 8 : 7],
  ]);
  if (r.quality !== "power")
    toneMap.set(
      r.quality === "sus2" ? 2 : r.quality === "sus4" ? 4 : 3,
      thirds[r.quality],
    );
  if (r.extension === 6) toneMap.set(6, 9);
  if (r.extension >= 7)
    toneMap.set(7, r.seventh === "major" ? 11 : r.seventh === "minor" ? 10 : 9);
  if (r.extension >= 9) toneMap.set(9, 14);
  if (r.extension >= 11) toneMap.set(11, 17);
  if (r.extension >= 13) toneMap.set(13, 21);
  const natural = [0, 2, 4, 5, 7, 9, 11];
  const modified = new Set<number>();
  for (const t of r.tones) {
    if (
      !t ||
      !Number.isInteger(t.degree) ||
      t.degree < 1 ||
      t.degree > 13 ||
      !Number.isInteger(t.alteration) ||
      Math.abs(t.alteration) > 2 ||
      modified.has(t.degree)
    )
      throw new Error(
        "Added/altered tones need unique degrees 1–13 and alterations -2…2",
      );
    modified.add(t.degree);
    toneMap.set(
      t.degree,
      natural[(t.degree - 1) % 7]! +
        12 * Math.floor((t.degree - 1) / 7) +
        t.alteration,
    );
  }
  for (const d of r.omit) toneMap.delete(d);
  if (!toneMap.size) throw new Error("A chord must retain at least one note");
  const notes = [...toneMap]
    .map(([degree, n]) => ({
      id: `tone-${degree}`,
      pitch: shiftPitch(pitch, degree - 1, n),
    }))
    .sort((a, b) => semitone(a.pitch) - semitone(b.pitch));
  if (
    !Number.isInteger(r.inversion) ||
    r.inversion < 0 ||
    r.inversion >= notes.length
  )
    throw new Error("Inversion must select a retained chord tone");
  for (let i = 0; i < r.inversion; i++) {
    const n = notes.shift()!;
    do {
      n.pitch = shiftPitch(n.pitch, 7, 12);
    } while (semitone(n.pitch) <= semitone(notes.at(-1)!.pitch));
    notes.push(n);
  }
  let suffix =
    r.quality === "diminished"
      ? r.extension >= 7 && r.seventh === "minor"
        ? "ø"
        : "°"
      : r.quality === "augmented"
        ? "+"
        : r.quality === "power" && !r.extension
          ? "5"
          : "";
  if (r.extension)
    suffix +=
      (r.extension >= 7 && r.seventh === "major" ? "maj" : "") + r.extension;
  if (r.quality.startsWith("sus")) suffix += r.quality;
  const details = [
    ...r.tones.map(
      (t) =>
        `${t.alteration < 0 ? "♭".repeat(-t.alteration) : "♯".repeat(t.alteration)}${t.degree}`,
    ),
    ...r.omit.map((n) => `no${n}`),
    ...(r.quality === "power" &&
    r.extension &&
    !toneMap.has(3) &&
    !r.omit.includes(3)
      ? ["no3"]
      : []),
    ...(r.inversion ? [`bass ${notes[0]!.id.slice(5)}`] : []),
  ];
  return {
    id,
    name,
    notes,
    labelTonic: { ...r.tonic },
    label: `${romanPitch(root, r.quality === "minor" || r.quality === "diminished")}${suffix}${r.target ? `/${r.target}` : ""}${details.length ? `(${details.join(",")})` : ""}`,
  };
}
