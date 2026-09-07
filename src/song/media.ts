import { type Song, type Take } from "./model.ts";
import { sectionLength, sectionSpans } from "./arrangement.ts";
import { cmp, add, time, value, type Time } from "./time.ts";
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
const finite = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) && n >= lo && n <= hi;
export function validateMedia(s: Song) {
  for (const a of Object.values(s.tables.assets))
    if (
      !/^[a-f0-9]{64}$/.test(a.id) ||
      typeof a.mime !== "string" ||
      !/^audio\/[a-z0-9.+-]+(?:;[a-zA-Z0-9= .+-]+)*$/.test(a.mime) ||
      !Number.isSafeInteger(a.bytes) ||
      !finite(a.bytes, 1, MAX_ASSET_BYTES) ||
      !finite(a.duration, 0.001, 600)
    )
      throw new Error(
        "Invalid media digest, MIME, size or duration (max25 MiB/10 minutes)",
      );
  for (const t of Object.values(s.tables.takes)) {
    const a = s.tables.assets[t.assetId];
    if (!a || !Object.hasOwn(s.tables.parts, t.partId))
      throw new Error("Take needs an asset and part");
    if (
      !Array.isArray(t.start) ||
      t.start.length !== 2 ||
      time(t.start[0], t.start[1]).join() !== t.start.join() ||
      cmp(t.start, [0, 1]) < 0
    )
      throw new Error("Take starts use exact nonnegative quarters");
    if (
      t.sectionId !== null &&
      (!Object.hasOwn(s.tables.sections, t.sectionId) ||
        cmp(t.start, sectionLength(s, t.sectionId)) >= 0)
    )
      throw new Error("Take start must fit its section");
    if (
      !finite(t.offset, 0, a.duration) ||
      !finite(t.duration, 0.001, a.duration) ||
      t.offset + t.duration > a.duration + 1e-7 ||
      !finite(t.gain, 0, 1) ||
      typeof t.muted !== "boolean"
    )
      throw new Error("Take trim/gain must fit its asset");
  }
}
export function takePlacements(
  s: Song,
): (Take & { appearanceId: string | null; at: Time })[] {
  const spans = sectionSpans(s),
    out: (Take & { appearanceId: string | null; at: Time })[] = [];
  for (const t of Object.values(s.tables.takes)) {
    if (t.sectionId === null)
      out.push({ ...t, appearanceId: null, at: t.start });
    else
      for (const span of spans)
        if (span.sectionId === t.sectionId) {
          out.push({
            ...t,
            appearanceId: span.id,
            at: add(span.start, t.start),
          });
          if (out.length > 10000) throw new Error("Too many take appearances");
        }
  }
  if (out.length > 10000) throw new Error("Too many take appearances");
  return out.sort((a, b) => cmp(a.at, b.at));
}
export function takeSchedule(s: Song, from: number) {
  if (!Number.isFinite(from) || from < 0) throw new Error("Invalid media seek");
  const seconds = 60 / (s.tempo.bpm * value(s.tempo.beatUnit));
  return takePlacements(s).flatMap((t) => {
    const part = s.tables.parts[t.partId]!;
    if (t.muted || part.muted || t.gain * part.volume === 0) return [];
    const start = value(t.at),
      skip = Math.max(0, (from - start) * seconds);
    if (skip >= t.duration) return [];
    return [
      {
        takeId: t.id,
        assetId: t.assetId,
        at: Math.max(start, from),
        offset: t.offset + skip,
        duration: t.duration - skip,
        gain: t.gain * part.volume,
        appearanceId: t.appearanceId,
      },
    ];
  });
}
