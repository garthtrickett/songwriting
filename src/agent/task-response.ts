import type { TaskView, StepView, Checkpoint, TaskSnapshot, Effect } from "./tasks.ts";

// Decode before publishing state: TypeScript types do not validate bridge JSON.
// Pre-workflow bridges omit checkpoint, snapshot and segment metadata entirely.
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid agent task response: expected object");
  return value as Row;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid agent task text");
  return value;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid agent task count");
  return value;
}
function list<T>(value: unknown, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error("Invalid agent task list");
  return value.map(decode);
}
function choice<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value !== "string" || !values.includes(value))
    throw new Error("Invalid agent task status");
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid agent task flag");
  return value;
}
const nullableText = (value: unknown) => value === null ? null : text(value);
function checkpoint(value: unknown): Checkpoint {
  if (value == null) return { version: 0, summary: "", nextStep: "", items: [], at: 0 };
  const c = row(value);
  return {
    version: count(c.version), summary: text(c.summary), nextStep: text(c.nextStep), at: count(c.at),
    items: list(c.items, (value) => {
      const i = row(value);
      return { id: text(i.id), title: text(i.title), note: text(i.note),
        status: choice(i.status, ["pending", "in_progress", "completed", "failed", "skipped"]) };
    }),
  };
}
function snapshot(value: unknown, songId: string | null): TaskSnapshot {
  if (value == null) return { songId, revision: null, instructions: "", preferences: "", toolVersion: "legacy" };
  const s = row(value);
  return { songId: nullableText(s.songId), revision: s.revision === null ? null : count(s.revision),
    instructions: text(s.instructions), preferences: text(s.preferences), toolVersion: text(s.toolVersion) };
}
function effect(value: unknown): Effect | null {
  if (value == null) return null;
  const e = row(value);
  return { songId: text(e.songId), operationId: text(e.operationId), revision: count(e.revision),
    label: text(e.label), affectedTotal: count(e.affectedTotal),
    affected: list(e.affected, (value) => {
      const a = row(value);
      return { table: text(a.table), id: text(a.id) };
    }) };
}
function step(value: unknown): StepView {
  const s = row(value);
  return { id: text(s.id), name: text(s.name), status: choice(s.status, ["pending", "sent", "done"]),
    effect: effect(s.effect), error: text(s.error ?? "") };
}
export function readTaskStatus(value: unknown): TaskView[] {
  return list(row(value).tasks, (value) => {
    const t = row(value), songId = nullableText(t.songId), steps = list(t.steps, step);
    return {
      id: text(t.id), clientId: text(t.clientId), songId, prompt: text(t.prompt),
      status: choice(t.status, ["pending", "running", "waiting", "partial", "completed", "failed", "cancelled"]),
      summary: text(t.summary), provider: text(t.provider), model: text(t.model), createdAt: count(t.createdAt),
      steps: steps.slice(-10), stepCount: count(t.stepCount ?? steps.length),
      checkpoint: checkpoint(t.checkpoint), snapshot: snapshot(t.snapshot, songId),
      segment: count(t.segment ?? 0), segmentStart: count(t.segmentStart ?? 0),
      segmentCalls: count(t.segmentCalls ?? 0), needsContext: flag(t.needsContext ?? false),
    };
  });
}
