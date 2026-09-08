import { expect, it } from "bun:test";
import { TaskStore } from "../../server/task-store.ts";
import { readTaskStatus } from "./task-response.ts";
const legacy = () => ({
  id: "old-task", clientId: "browser", songId: "song", prompt: "Develop reply",
  status: "running", summary: "Working", provider: "test", model: "legacy", createdAt: 1,
  steps: [{ id: "read", name: "context", status: "done", args: {}, result: { revision: 1 }, sentAt: 1 }],
});
it("adapts pre-workflow bridge tasks without changing status, identity or source data", () => {
  const source = legacy(), before = structuredClone(source);
  const t = readTaskStatus({ tasks: [source] })[0]!;
  expect(source).toEqual(before);
  expect(t.id).toBe(source.id);
  expect(t.status).toBe("running");
  expect(t.checkpoint.items).toEqual([]);
  expect(t.snapshot).toEqual({ songId: "song", revision: null, instructions: "", preferences: "", toolVersion: "legacy" });
  expect(t.stepCount).toBe(1);
  expect(t.steps).toEqual([{ id: "read", name: "context", status: "done", effect: null, error: "" }]);
});
it("preserves modern checkpoint progress, original guidance and durable review metadata", async () => {
  const store = new TaskStore([], async () => {});
  const t = await store.create("browser", "song", "Develop reply", {
    songId: "song", revision: 12, instructions: "Preserve bass", preferences: "7/8", toolVersion: "phase7-workflows-v1",
  });
  await store.claim(t.id, "test", "modern");
  await store.call(t.id, "edit", "mutate", { operationId: "edit" });
  await store.result(t.id, "browser", "edit", { ok: true, value: { id: "song", history: [
    { operationId: "edit", revision: 13, label: "Reply", deltas: [{ table: "patterns", id: "reply" }] },
  ] } });
  await store.checkpoint(t.id, 0, { summary: "Reply saved", nextStep: "Review", items: [
    { id: "reply", title: "Write reply", status: "completed", note: "Saved" },
  ] });
  const tasks = store.list();
  expect(readTaskStatus({ tasks })).toEqual(tasks);
});
it("bounds old full step histories while preserving their total", () => {
  const t = legacy();
  t.steps = Array.from({ length: 30 }, (_, i) => ({ ...t.steps[0]!, id: String(i) }));
  const decoded = readTaskStatus({ tasks: [t] })[0]!;
  expect(decoded.stepCount).toBe(30);
  expect(decoded.steps).toHaveLength(10);
  expect(decoded.steps[0]!.id).toBe("20");
});
it("rejects malformed responses before exposing any tasks to the view", () => {
  for (const input of [null, {}, { tasks: null }, { tasks: [null] },
    { tasks: [legacy(), { ...legacy(), checkpoint: { items: null } }] },
    { tasks: [{ ...legacy(), snapshot: {} }] },
    { tasks: [{ ...legacy(), status: null }] },
    { tasks: [{ ...legacy(), steps: [null] }] },
  ]) expect(() => readTaskStatus(input)).toThrow();
});
