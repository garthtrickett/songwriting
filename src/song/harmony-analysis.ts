import {
  type Song,
  type HarmonicRegion,
  type Pitch,
  semitone,
  pitchLabel,
} from "./model.ts";
import { sectionSpans } from "./arrangement.ts";
import { sounds } from "./timeline.ts";
import { add, cmp, ZERO, time, type Time } from "./time.ts";
import {
  TONIC,
  pc,
  checkedPitch,
  relativePitch,
  romanPitch,
} from "./harmony-pitch.ts";
import { buildChord, QUALITIES, type ChordRecipe } from "./chord-builder.ts";
export function harmonicSpans(s: Song) {
  const appearances = sectionSpans(s);
  const out: (HarmonicRegion & { appearanceId: string | null })[] = [];
  for (const h of Object.values(s.tables.harmony)) {
    if (h.sectionId === null) out.push({ ...h, appearanceId: null });
    else
      for (const a of appearances)
        if (a.sectionId === h.sectionId) {
          out.push({ ...h, start: add(a.start, h.start), appearanceId: a.id });
          if (out.length > 100000)
            throw new Error("Too many harmonic region appearances");
        }
  }
  return out.sort((a, b) => cmp(a.start, b.start));
}
export function harmonicContext(s: Song, at: Time) {
  if (
    !Array.isArray(at) ||
    at.length !== 2 ||
    time(at[0], at[1]).join() !== at.join() ||
    cmp(at, ZERO) < 0
  )
    throw new Error("Use an exact nonnegative context position");
  const active = harmonicSpans(s).filter(
    (h) => cmp(at, h.start) >= 0 && cmp(at, add(h.start, h.duration)) < 0,
  );
  const h = active.find((h) => h.sectionId !== null) ?? active[0];
  return {
    at,
    regionId: h?.id ?? null,
    tonic: h?.tonic ?? TONIC,
    mode: h?.mode ?? s.mode,
    annotation: h?.annotation ?? "",
  };
}
const MODES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  "melodic minor": [0, 2, 3, 5, 7, 9, 11],
};
export function interpretations(
  notes: Pitch[],
  tonic: Pitch = TONIC,
  mode = "major",
) {
  checkedPitch(tonic);
  for (const p of notes) checkedPitch(p);
  if (notes.length > 64) throw new Error("Inspect at most 64 distinct pitches");
  const classes = [...new Set(notes.map((p) => pc(semitone(p))))].sort(
    (a, b) => a - b,
  );
  const modeSteps = MODES[mode.toLowerCase()],
    inMode = modeSteps
      ? classes.every((n) => modeSteps.includes(pc(n - semitone(tonic))))
      : null;
  const bass = [...notes].sort((a, b) => semitone(a) - semitone(b))[0] ?? null;
  const candidates: {
    symbol: string;
    root: Pitch;
    bass: Pitch;
    quality: string;
  }[] = [];
  if (bass)
    for (const n of [
      ...new Map(notes.map((p) => [pc(semitone(p)), p])).values(),
    ]) {
      let root: Pitch;
      try {
        root = relativePitch(n, tonic);
        root = { ...root, octave: 0 };
      } catch {
        continue;
      }
      for (const quality of QUALITIES)
        for (const extension of [0, 6, 7, 9, 11, 13] as const)
          for (const seventh of (extension >= 7
            ? [
                "major",
                "minor",
                ...(quality === "diminished" ? ["diminished"] : []),
              ]
            : ["minor"]) as ChordRecipe["seventh"][]) {
            if (quality === "power" && extension !== 0) continue;
            let c;
            try {
              c = buildChord("candidate", "Candidate", {
                root: romanPitch(root),
                quality,
                extension,
                seventh,
                tones: [],
                omit: [],
                inversion: 0,
                octave: 0,
                target: null,
                tonic,
              });
            } catch {
              continue;
            }
            const pcs = [
              ...new Set(c.notes.map((n) => pc(semitone(n.pitch)))),
            ].sort((a, b) => a - b);
            if (pcs.join() === classes.join())
              candidates.push({
                symbol: c.label!,
                root: c.notes[0]!.pitch,
                bass,
                quality,
              });
          }
    }
  return {
    pitchClasses: classes,
    bass,
    inMode,
    candidates: candidates.slice(0, 32),
    totalCandidates: candidates.length,
    truncated: candidates.length > 32,
    unresolved: candidates.length === 0,
  };
}
export function chordCandidates(
  s: Song,
  id: string,
  tonic?: Pitch,
  mode?: string,
) {
  const c = s.tables.chords[id];
  if (!c) throw new Error("Unknown chord");
  const reference = tonic ?? c.labelTonic;
  return {
    chordId: id,
    label: c.label,
    tonic: reference,
    ...interpretations(
      c.notes.map((n) => n.pitch),
      reference,
      mode ?? s.mode,
    ),
  };
}
export function soundingHarmony(s: Song, at: Time) {
  const context = harmonicContext(s, at);
  const active = sounds(s).filter(
    (n) =>
      n.pitch &&
      n.gain > 0 &&
      cmp(n.start, at) <= 0 &&
      cmp(at, add(n.start, n.duration)) < 0,
  );
  const unique = [
    ...new Map(active.map((n) => [pitchLabel(n.pitch!), n.pitch!])).values(),
  ];
  const voices = [...new Set(active.map((n) => n.voiceId))].map((id) => ({
    id,
    name: s.tables.voices[id]!.name,
    notes: active
      .filter((n) => n.voiceId === id)
      .map((n) => ({
        eventId: n.eventId,
        pitch: n.pitch,
        start: n.start,
        duration: n.duration,
        gain: n.gain,
      })),
  }));
  if (active.length > 512)
    throw new Error("Too many simultaneous sounds to inspect");
  return {
    context,
    voices,
    ...interpretations(unique, context.tonic, context.mode),
  };
}
