import type { Snapshot } from "../../generated/desktop/Snapshot.ts";
import type { Failure } from "../../generated/desktop/Failure.ts";
export type { Snapshot, Failure };

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 40000;
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const time = (v: unknown) => Array.isArray(v) && v.length === 2 && integer(v[0]) && integer(v[1]) && v[0] >= 0 && v[1] > 0;
const items = (v: unknown, check: (item: Record<string, unknown>) => boolean) =>
  Array.isArray(v) && v.length <= 20000 && v.every((item) => record(item) && check(item));

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
    || !items(input.undoable, (u) => text(u.operationId) && text(u.label))) {
    throw new Error("Invalid desktop state received; reconnect to reload the saved song.");
  }
  return structuredClone(input) as unknown as Snapshot;
}
export function failure(value: unknown): Failure {
  return record(value) && text(value.code) && text(value.message)
    ? { code: value.code, message: value.message }
    : { code: "transport", message: value instanceof Error ? value.message : String(value) };
}
