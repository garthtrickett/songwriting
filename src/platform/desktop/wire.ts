import type { Snapshot } from "../../generated/desktop/Snapshot.ts";
import type { Failure } from "../../generated/desktop/Failure.ts";
export type { Snapshot, Failure };

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 40000;
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const time = (v: unknown) => Array.isArray(v) && v.length === 2 && integer(v[0]) && integer(v[1]) && v[0] >= 0 && v[1] > 0;
const items = (v: unknown, check: (item: Record<string, unknown>) => boolean, limit = 20000) =>
  Array.isArray(v) && v.length <= limit && v.every((item) => record(item) && check(item));
const maybe = (v: unknown): v is string | null => v === null || text(v);
const real = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const flag = (v: unknown): v is boolean => typeof v === "boolean";
const integers = (v: unknown) => Array.isArray(v) && v.length <= 64 && v.every(integer);

// Arranged rows expand per appearance, so they are bounded by the Rust
// projection's own caps (100000 annotations, 10000 takes) rather than by the
// smaller object-table bound. A tighter limit here would reject a legitimate
// large song outright and leave the writer staring at a transport error.
function library(v: unknown): boolean {
  return record(v)
    && items(v.appearances, (a) => text(a.id) && text(a.name) && text(a.sectionId) && text(a.section)
      && integer(a.bars) && time(a.start) && time(a.length))
    && items(v.markers, (m) => text(m.id) && text(m.name) && time(m.at))
    && items(v.annotations, (a) => text(a.table) && text(a.id) && text(a.name)
      && time(a.start) && time(a.duration) && text(a.appearanceId), 100000)
    && items(v.harmony, (h) => text(h.id) && text(h.name) && maybe(h.sectionId) && maybe(h.section)
      && time(h.start) && time(h.duration) && text(h.tonic) && text(h.mode) && text(h.annotation))
    && items(v.parts, (p) => text(p.id) && text(p.name) && text(p.instrument)
      && real(p.volume) && flag(p.muted) && integer(p.voices))
    && items(v.voices, (x) => text(x.id) && text(x.name) && text(x.partId) && text(x.part))
    && items(v.chords, (c) => text(c.id) && text(c.name) && maybe(c.label) && text(c.tonic)
      && Array.isArray(c.notes) && c.notes.length <= 64 && c.notes.every(text))
    && items(v.polyrhythms, (p) => text(p.id) && text(p.name) && maybe(p.sectionId) && maybe(p.section)
      && time(p.start) && time(p.duration) && items(p.lanes, (l) => text(l.occurrenceId)
        && text(l.occurrence) && integer(l.divisions)))
    && items(v.fretted, (f) => text(f.id) && text(f.name) && text(f.partId) && text(f.part)
      && integer(f.tonic) && integers(f.tuning) && integer(f.capo) && integer(f.maxFret)
      && integer(f.handSpan) && integer(f.fingerings))
    && items(v.takes, (t) => text(t.id) && text(t.name) && text(t.assetId) && maybe(t.asset)
      && text(t.partId) && maybe(t.part) && maybe(t.section) && maybe(t.appearanceId)
      && time(t.start) && time(t.at) && real(t.offset) && real(t.duration) && real(t.gain)
      && flag(t.muted), 10000)
    && items(v.lyrics, (l) => text(l.id) && text(l.name) && text(l.sectionId) && maybe(l.section)
      && time(l.start) && time(l.duration) && text(l.text) && maybe(l.phraseId) && maybe(l.partId))
    && items(v.phrases, (x) => text(x.id) && text(x.name) && text(x.sectionId) && maybe(x.section)
      && time(x.start) && time(x.duration))
    && items(v.prompts, (x) => text(x.id) && text(x.name) && text(x.text))
    && record(v.writing) && text(v.writing.instructions) && text(v.writing.preferences)
    && text(v.writing.mode) && text(v.writing.degreeReference) && real(v.writing.bpm)
    && time(v.writing.beatUnit);
}

// Validate transport shape and rendering bounds, not musical acceptance rules.
export function snapshot(input: unknown): Snapshot {
  if (!record(input) || input.protocol !== 1 || !text(input.epoch) || !input.epoch || !text(input.profile)
    || !integer(input.revision) || input.revision < 0 || !text(input.title)
    || !(input.warning === null || text(input.warning))
    || !items(input.patterns, (p) => text(p.id) && text(p.name) && time(p.length))
    || !items(input.notes, (n) => text(n.eventId) && (n.memberId === null || text(n.memberId))
      && text(n.patternId) && text(n.label) && integer(n.row) && Math.abs(n.row) <= 100
      && time(n.start) && time(n.duration))
    || !items(input.bars, (b) => text(b.label) && text(b.section) && time(b.start) && time(b.duration)
      && Array.isArray(b.groups) && b.groups.length <= 64 && b.groups.every(integer))
    || !items(input.placements, (p) => text(p.id) && text(p.name) && text(p.voice) && text(p.patternId) && time(p.start) && time(p.duration))
    || !items(input.undoable, (u) => text(u.operationId) && text(u.label))
    || !items(input.redoable, (u) => text(u.operationId) && text(u.label))
    || !library(input.library)) {
    throw new Error("Invalid desktop state received; reconnect to reload the saved song.");
  }
  return structuredClone(input) as unknown as Snapshot;
}
export function failure(value: unknown): Failure {
  return record(value) && text(value.code) && text(value.message)
    ? { code: value.code, message: value.message }
    : { code: "transport", message: value instanceof Error ? value.message : String(value) };
}
