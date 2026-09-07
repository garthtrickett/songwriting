import { test, expect, type Page } from "@playwright/test";
import { acceptance } from "../acceptance.ts";
import type { Song } from "../../src/song/model.ts";
const tool = (page: Page, name: string, args: unknown = {}) =>
  page.evaluate(
    async ({ name, args }) => (window as any).songwriting.tool(name, args),
    { name, args },
  );
const boot = async (page: Page) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).songwriting));
};
test("manual composition imports, edits, auditions, undoes, and reloads", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Start a song" }).click();
  await expect(page.getByLabel("Song title")).toHaveValue("First sketch");
  const context = await tool(page, "context");
  const s = acceptance(context.songId);
  await page.getByText("Song document · atomic editing").click();
  await page.getByRole("button", { name: "Edit complete song" }).click();
  await page.getByLabel("Song JSON").fill(JSON.stringify(s));
  await page.getByRole("button", { name: "Apply document" }).click();
  await expect(page.getByLabel("Song title")).toHaveValue("Seven meets eight");
  await expect(page.locator(".note-block").first()).toBeVisible();
  await expect(page.locator(".ruler-body")).toContainText("7/8");
  await page
    .getByRole("button", { name: "Find and mark next cycle alignment" })
    .click();
  await expect(page.locator(".marker-lane")).toContainText("28 q");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(250);
  const scheduled = await page.evaluate(
    () => (window as any).songwriting.controller.audio.scheduled,
  );
  expect(scheduled.length).toBeGreaterThan(2);
  expect(scheduled.some((s: any) => s.frequency > 0)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).songwriting.controller.audio.outputLevel,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as any).songwriting.controller.audio.activeSources,
    ),
  ).toBe(0);
  await page.getByLabel("Song title").fill("Changed by writer");
  await page.getByLabel("Song title").press("Tab");
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Song title")).toHaveValue("Changed by writer");
  const exported = JSON.parse(await tool(page, "export"));
  expect(exported.tables.chords.tonic.notes).toHaveLength(3);
  expect(exported.tables.markers).not.toEqual({});
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export", exact: false })
    .first()
    .click();
  expect((await download).suggestedFilename().endsWith(".song.json")).toBe(
    true,
  );
  const ctx = await tool(page, "context");
  const rename = ctx.history.findLast((h: any) => h.label === "Rename song");
  const result = await tool(page, "mutate", {
    songId: ctx.songId,
    expectedRevision: ctx.revision,
    operationId: "undo-title",
    label: "Undo writer rename",
    command: { kind: "undo", targetId: rename.operationId },
  });
  expect(result.ok).toBe(true);
  await expect(page.getByLabel("Song title")).toHaveValue("Seven meets eight");
});
test("two tabs reject stale writes and preserve imports and operations", async ({
  page,
  context,
}) => {
  await boot(page);
  await tool(page, "import", {
    text: JSON.stringify(acceptance()),
    asCopy: false,
    operationId: "import-1",
  });
  const other = await context.newPage();
  await boot(other);
  const old = await tool(other, "context");
  await page.getByLabel("Song title").fill("Writer wins");
  await page.getByLabel("Song title").press("Tab");
  await expect(page.getByText("All changes saved")).toBeVisible();
  const stale = {
    songId: "acceptance",
    expectedRevision: old.revision,
    operationId: "stale",
    label: "Stale agent edit",
    command: {
      kind: "edit",
      changes: [{ table: "meta", id: "title", value: "Lost update" }],
    },
  };
  expect((await tool(other, "mutate", stale)).ok).toBe(false);
  expect(JSON.parse(await tool(page, "export")).title).toBe("Writer wins");
  await tool(other, "import", {
    text: JSON.stringify(acceptance()),
    asCopy: false,
    operationId: "import-1",
  });
  expect((await tool(other, "context")).songs).toHaveLength(1);
  await other.close();
});
test("agent bridge persists task delivery and exact operation retry", async ({
  page,
}) => {
  await boot(page);
  await tool(page, "import", {
    text: JSON.stringify(acceptance()),
    asCopy: false,
    operationId: "load",
  });
  await expect(
    page.getByRole("button", { name: "Send to agent" }),
  ).toBeEnabled();
  await page.getByLabel("Agent request").fill("Mark where the cycles meet.");
  await page.getByRole("button", { name: "Send to agent" }).click();
  await expect(page.locator(".task")).toContainText("Mark where");
  const { readFile } = await import("node:fs/promises");
  const token = (await readFile(".agent/token", "utf8")).trim();
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const tasks = (await (
    await fetch("http://127.0.0.1:5189/bridge/tasks", { headers })
  ).json()) as any[];
  const task = tasks
    .slice()
    .reverse()
    .find((t: any) => t.prompt === "Mark where the cycles meet.")!;
  const api = async (path: string, body: any) => {
    const r = await fetch(`http://127.0.0.1:5189/bridge/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return r.json() as Promise<any>;
  };
  await api("claim", {
    taskId: task.id,
    provider: "test",
    model: "deterministic-transport-test",
  });
  await api("call", {
    taskId: task.id,
    stepId: "alignment-test-" + task.id,
    name: "alignment",
    args: { occurrenceIds: ["guitar", "drums"], after: [0, 1], until: [32, 1] },
  });
  await expect
    .poll(async () => {
      const r = await fetch(
        `http://127.0.0.1:5189/bridge/step?taskId=${task.id}&stepId=alignment-test-${task.id}`,
        { headers },
      );
      return ((await r.json()) as any).status;
    })
    .toBe("done");
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  await api("finish", {
    taskId: task.id,
    status: "completed",
    summary: "Cycles meet at 28 quarter notes.",
  });
  await expect(page.locator(".task")).toContainText("Cycles meet at 28");
});
test("a mutation survives a lost bridge response without being committed twice", async ({
  page,
}) => {
  await boot(page);
  await tool(page, "import", {
    text: JSON.stringify(acceptance()),
    asCopy: false,
    operationId: "initial",
  });
  await expect(
    page.getByRole("button", { name: "Send to agent" }),
  ).toBeEnabled();
  await page
    .getByLabel("Agent request")
    .fill("Recovery test: rename this song.");
  await page.getByRole("button", { name: "Send to agent" }).click();
  await expect(page.locator(".task")).toContainText("Recovery test");
  const { readFile } = await import("node:fs/promises");
  const token = (await readFile(".agent/token", "utf8")).trim();
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const api = async (path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:5189/bridge/${path}`, {
      headers,
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    return r.json() as Promise<any>;
  };
  const tasks = await api("tasks");
  const task = tasks
    .slice()
    .reverse()
    .find((t: any) => t.prompt === "Recovery test: rename this song.");
  const stepId = `lost-${task.id}`;
  await api("claim", {
    taskId: task.id,
    provider: "test",
    model: "transport-recovery",
  });
  await page.route("**/bridge/result", (route) => route.abort());
  await api("call", {
    taskId: task.id,
    stepId,
    name: "mutate",
    args: {
      songId: "acceptance",
      expectedRevision: 1,
      operationId: "once-only",
      label: "Recovered rename",
      command: {
        kind: "edit",
        changes: [{ table: "meta", id: "title", value: "Durably changed" }],
      },
    },
  });
  await expect(page.getByLabel("Song title")).toHaveValue("Durably changed");
  // Remove the browser delivery cache to exercise the durable operation receipt too.
  await page.evaluate(async (id) => {
    const db = (window as any).songwriting.controller.db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite");
      tx.objectStore("sessions").delete(id);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  }, stepId);
  await page.unroute("**/bridge/result");
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  await expect
    .poll(
      async () => (await api(`step?taskId=${task.id}&stepId=${stepId}`)).status,
      { timeout: 12000 },
    )
    .toBe("done");
  const ctx = await tool(page, "context");
  expect(ctx.revision).toBe(2);
  expect(
    ctx.history.filter((h: any) => h.operationId === "once-only"),
  ).toHaveLength(1);
  await api("finish", {
    taskId: task.id,
    status: "completed",
    summary: "One durable edit after redelivery.",
  });
});
test("normal inspectors create notes and recover a deleted song", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Start a song" }).click();
  await page.getByRole("button", { name: "Add", exact: false }).first().click();
  await page.getByLabel("Cycle length · quarter notes").fill("7/2");
  await page.getByLabel("Cycle length · quarter notes").press("Tab");
  await page.getByRole("button", { name: "events", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: false }).first().click();
  await page.getByLabel("Note start").fill("1/3");
  await page.getByLabel("Note start").press("Tab");
  await expect
    .poll(
      async () =>
        Object.values(JSON.parse(await tool(page, "export")).tables.events)[0],
    )
    .toMatchObject({ start: [1, 3] });
  await page.getByText("Song document · atomic editing").click();
  await page
    .getByRole("button", { name: "Move song to recently deleted" })
    .click();
  await expect(
    page.getByRole("button", { name: "Start a song" }),
  ).toBeVisible();
  await page.getByText("Recently deleted · 1").click();
  await page.getByRole("button", { name: "Restore First sketch" }).click();
  await expect(page.getByLabel("Song title")).toHaveValue("First sketch");
});
