import { expect, it } from "bun:test";
import { TaskStore } from "../../server/task-store.ts";
import type { Task } from "./tasks.ts";
const checkpoint = {
  summary: "Preserved the bass",
  nextStep: "Develop reply",
  items: [
    {
      id: "reply",
      title: "Develop reply",
      status: "pending" as const,
      note: "",
    },
  ],
};
async function setup() {
  let disk: Task[] = [];
  const store = new TaskStore([], async (rows) => {
    disk = structuredClone(rows);
  });
  const t = await store.create("browser", "song", "Develop a reply");
  await store.claim(t.id, "test", "store-test");
  return { store, id: t.id, disk: () => disk };
}
it("checkpoints survive host restart and resume requires a freshly delivered context", async () => {
  const { store, id, disk } = await setup();
  await store.checkpoint(id, 0, checkpoint);
  const restarted = new TaskStore(disk(), async () => {});
  expect(restarted.info(id).status).toBe("waiting");
  expect(restarted.info(id).checkpoint.version).toBe(1);
  await restarted.control(id, "browser", "resume");
  await restarted.claim(id, "test", "resumed");
  await expect(restarted.call(id, "edit", "mutate", {})).rejects.toThrow(
    "context",
  );
  await restarted.call(id, "fresh", "context", {});
  await restarted.poll("browser");
  await restarted.result(id, "browser", "fresh", {
    songId: "song",
    revision: 4,
  });
  await restarted.call(id, "edit", "mutate", { expectedRevision: 4 });
  expect(restarted.info(id).needsContext).toBe(false);
});
it("failed task persistence is invisible and the next serialized save can succeed", async () => {
  let fail = true,
    disk: Task[] = [];
  const store = new TaskStore([], async (rows) => {
    if (fail) throw new Error("disk full");
    disk = structuredClone(rows);
  });
  await expect(store.create("browser", null, "Write")).rejects.toThrow(
    "disk full",
  );
  expect(store.list()).toEqual([]);
  fail = false;
  await Promise.all([
    store.create("browser", null, "One"),
    store.create("browser", null, "Two"),
  ]);
  expect(store.list()).toHaveLength(2);
  expect(disk).toHaveLength(2);
});
it("explicit completion rejects unfinished work and checkpoint conflicts preserve progress", async () => {
  const { store, id } = await setup();
  await store.checkpoint(id, 0, checkpoint);
  await expect(
    store.checkpoint(id, 0, { ...checkpoint, summary: "Stale" }),
  ).rejects.toThrow("conflict");
  await expect(store.finish(id, "completed", "Done")).rejects.toThrow(
    "unfinished",
  );
  await store.checkpoint(id, 1, {
    ...checkpoint,
    items: checkpoint.items.map((i) => ({
      ...i,
      status: "completed" as const,
    })),
  });
  await store.call(id, "read", "read", {});
  await expect(store.finish(id, "completed", "Done")).rejects.toThrow(
    "outstanding",
  );
  await store.result(id, "browser", "read", {});
  expect((await store.finish(id, "completed", "Verified")).status).toBe(
    "completed",
  );
});
it("step retries cannot change arguments or overwrite their original result", async () => {
  const { store, id } = await setup();
  await store.call(id, "same", "read", { table: "events" });
  await expect(store.call(id, "same", "mutate", {})).rejects.toThrow(
    "identity",
  );
  await store.result(id, "browser", "same", { value: 1 });
  await store.result(id, "browser", "same", { value: 2 });
  expect(store.step(id, "same")!.result).toEqual({ value: 1 });
});
it("execution limits preserve checkpoints and allow bounded continuation", async () => {
  let now = 1;
  const store = new TaskStore(
      [],
      async () => {},
      () => now,
    ),
    t = await store.create("b", null, "Long task");
  await store.claim(t.id, "test", "limits");
  for (let n = 0; n < 100; n++) {
    await store.call(t.id, `s${n}`, "read", {});
    await store.result(t.id, "b", `s${n}`, {});
  }
  expect(await store.call(t.id, "over", "read", {})).toHaveProperty("error");
  expect(store.info(t.id).status).toBe("waiting");
  await store.control(t.id, "b", "resume");
  await store.claim(t.id, "test", "limits");
  await store.call(t.id, "context", "context", {});
  await store.result(t.id, "b", "context", {});
  expect(store.info(t.id).needsContext).toBe(false);
  now += 15 * 60 * 1000;
  expect(await store.call(t.id, "expired", "read", {})).toHaveProperty("error");
  expect(store.info(t.id).stepCount).toBe(101);
});
it("task views omit large tool payloads but expose durable changes and explicit song binding", async () => {
  const { store, id } = await setup();
  await store.call(id, "import", "import", {
    operationId: "copy",
    text: "large private document",
  });
  const h = {
    operationId: "copy",
    revision: 1,
    label: "Import",
    deltas: [{ table: "events", id: "note" }],
  };
  await store.result(id, "browser", "import", {
    ok: true,
    value: { id: "copy-song", song: { id: "copy-song" }, history: [h] },
  });
  const view = store.info(id);
  expect(view.songId).toBe("copy-song");
  expect(view.steps[0]!.effect!.operationId).toBe("copy");
  expect(JSON.stringify(view)).not.toContain("large private document");
  expect(view.steps[0]).not.toHaveProperty("result");
});
it("invalid persisted tasks fail explicitly and legacy records migrate without erasing steps", () => {
  expect(() => new TaskStore({}, async () => {})).toThrow();
  const legacy = {
    id: "old",
    clientId: "b",
    songId: null,
    prompt: "Old work",
    status: "partial",
    summary: "Keep this",
    provider: "test",
    model: "old",
    createdAt: 1,
    steps: [
      {
        id: "step",
        name: "read",
        args: {},
        status: "done",
        result: { saved: true },
        sentAt: 0,
      },
    ],
  };
  const store = new TaskStore([legacy], async () => {});
  expect(store.info("old").checkpoint.version).toBe(0);
  expect(store.step("old", "step")!.result).toEqual({ saved: true });
});

it("old context delivery cannot unlock a resumed segment and expired queued tools remain pending", async () => {
  let now = 1;
  let disk: Task[] = [];
  const store = new TaskStore(
    [],
    async (rows) => {
      disk = structuredClone(rows);
    },
    () => now,
  );
  const t = await store.create("b", "song", "Resume safely");
  await store.claim(t.id, "test", "old");
  await store.call(t.id, "old-context", "context", {});
  await store.poll("b");
  now += 15 * 60 * 1000;
  expect(await store.poll("b")).toEqual([]);
  expect(store.info(t.id).status).toBe("waiting");
  await store.control(t.id, "b", "resume");
  await store.claim(t.id, "test", "new");
  await store.result(t.id, "b", "old-context", { songId: "song", revision: 1 });
  expect(store.info(t.id).needsContext).toBe(true);
  await store.call(t.id, "fresh-context", "context", {});
  await store.result(t.id, "b", "fresh-context", {
    songId: "song",
    revision: 2,
  });
  expect(store.info(t.id).needsContext).toBe(false);
});
