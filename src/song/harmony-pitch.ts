import { semitone, type Pitch } from "./model.ts";
export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
export const TONIC: Pitch = { degree: 1, alteration: 0, octave: 0 };
export function checkedPitch(p: Pitch): Pitch {
  if (
    !p ||
    !Number.isInteger(p.degree) ||
    p.degree < 1 ||
    p.degree > 7 ||
    !Number.isInteger(p.alteration) ||
    Math.abs(p.alteration) > 4 ||
    !Number.isInteger(p.octave) ||
    Math.abs(p.octave) > 5
  )
    throw new Error("Relative pitch outside supported range");
  return p;
}
export function shiftPitch(p: Pitch, steps: number, semitones: number): Pitch {
  checkedPitch(p);
  if (!Number.isSafeInteger(steps) || !Number.isSafeInteger(semitones))
    throw new Error("Intervals require integer steps and semitones");
  const d = p.octave * 7 + p.degree - 1 + steps,
    octave = Math.floor(d / 7),
    degree = d - octave * 7 + 1;
  return checkedPitch({
    degree,
    octave,
    alteration: semitone(p) + semitones - (MAJOR[degree - 1]! + octave * 12),
  });
}
export function relativePitch(p: Pitch, tonic: Pitch): Pitch {
  checkedPitch(tonic);
  return shiftPitch(
    p,
    -(tonic.degree - 1 + 7 * tonic.octave),
    -semitone(tonic),
  );
}
export function romanRoot(text: string): Pitch {
  if (typeof text !== "string") throw new Error("Choose a Roman root");
  const match = /^([b♭#♯]{0,4})(VII|III|VI|IV|II|V|I)$/i.exec(text.trim());
  if (!match)
    throw new Error("Roman root must be I–VII with optional flats or sharps");
  return {
    degree: ROMAN.indexOf(match[2]!.toUpperCase()) + 1,
    alteration: [...match[1]!].reduce(
      (n, c) => n + (c === "b" || c === "♭" ? -1 : 1),
      0,
    ),
    octave: 0,
  };
}
export function romanPitch(p: Pitch, minor = false) {
  const n = ROMAN[p.degree - 1]!;
  return `${p.alteration < 0 ? "♭".repeat(-p.alteration) : "♯".repeat(p.alteration)}${minor ? n.toLowerCase() : n}`;
}
export const pc = (n: number) => ((n % 12) + 12) % 12;
