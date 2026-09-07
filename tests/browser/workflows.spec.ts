import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { arrangementSong } from "../arrangement.ts";
const tool = (page: Page, name: string, args: unknown = {}) =>
  page.evaluate(
    async ({ name, args }) => (window as any).songwriting.tool(name, args),
    { name, args },
  );
async function boot(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  await tool(page, "import", {
    text: JSON.stringify(arrangementSong()),
    asCopy: false,
    operationId: "initial",
  });
}
async function api(path: string, body?: unknown) {
  const token = (await readFile(".agent/token", "utf8")).trim();
  const r = await fetch(`http://127.0.0.1:5189/bridge/${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  });
  const data = await r.json() as any;
  if (!data.error) expect(r.ok, `Successful ${path} response must have HTTP success status`).toBe(true);
  return data;
}
async function call(taskId: string, name: string, args: unknown = {}) {
  const stepId = crypto.randomUUID(),
    queued = await api("call", { taskId, stepId, name, args });
  if (queued.error) return queued;
  await expect
    .poll(
      async () => (await api(`step?taskId=${taskId}&stepId=${stepId}`)).status,
      { timeout: 12000 },
    )
    .toBe("done");
  return (await api(`step?taskId=${taskId}&stepId=${stepId}`)).result;
}
async function submit(page: Page, prompt: string) {
  await expect(
    page.getByRole("button", { name: "Send to agent" }),
  ).toBeEnabled();
  await page.getByLabel("Agent request").fill(prompt);
  await page.getByRole("button", { name: "Send to agent" }).click();
  await expect(page.locator(".task").last()).toContainText(prompt);
  return (await api("tasks")).findLast((t: any) => t.prompt === prompt);
}
test("ordinary writing guidance and reusable prompts are portable, undoable and retain stale drafts", async ({
  page,
  context,
}) => {
  await boot(page);
  await page
    .getByText("Writing guidance and reusable prompts", { exact: true })
    .click();
  await page
    .getByLabel("Project instructions", { exact: true })
    .fill("Preserve the bass and recorded takes.");
  await page
    .getByLabel("Songwriting preferences", { exact: true })
    .fill("Alternating 7/8 and 9/8; restrained tapping.");
  await page
    .getByRole("button", { name: "Save writing guidance", exact: true })
    .click();
  await expect
    .poll(async () => (await tool(page, "read")).writing.instructions)
    .toBe("Preserve the bass and recorded takes.");
  await page.getByLabel("Starting recipe").selectOption("variation");
  await page
    .getByLabel("Prompt name", { exact: true })
    .fill("A reply with space");
  await page
    .getByRole("button", { name: "Save reusable prompt", exact: true })
    .click();
  await expect
    .poll(
      async () => Object.keys((await tool(page, "read")).tables.prompts).length,
    )
    .toBe(1);
  await page
    .getByRole("button", { name: "Use prompt in request", exact: true })
    .click();
  await expect(page.getByLabel("Agent request")).toHaveValue(
    /independent variation/,
  );
  const exported = await tool(page, "writing_export");
  await page
    .getByRole("button", { name: "Delete reusable prompt", exact: true })
    .click();
  await expect
    .poll(
      async () => Object.keys((await tool(page, "read")).tables.prompts).length,
    )
    .toBe(0);
  const ctx = await tool(page, "context");
  expect(
    (
      await tool(page, "writing_import", {
        text: exported,
        songId: ctx.songId,
        expectedRevision: ctx.revision,
        operationId: "restore-guidance",
      })
    ).ok,
  ).toBe(true);
  await page
    .getByLabel("Project instructions", { exact: true })
    .fill("My unsaved guidance");
  const other = await context.newPage();
  await other.goto("/");
  await other.waitForFunction(() => Boolean((window as any).songwriting));
  const before = await tool(other, "context");
  expect(
    (
      await tool(other, "mutate", {
        songId: before.songId,
        expectedRevision: before.revision,
        operationId: "foreign-guidance",
        label: "Foreign preference",
        command: {
          kind: "edit",
          changes: [
            {
              table: "meta",
              id: "writing",
              value: {
                instructions: "Writer's other tab",
                preferences: "Keep the meter",
              },
            },
          ],
        },
      })
    ).ok,
  ).toBe(true);
  await expect(page.locator(".incoming")).toContainText("Foreign preference");
  await page
    .getByRole("button", { name: "Save writing guidance", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Revision conflict");
  await expect(
    page.getByLabel("Project instructions", { exact: true }),
  ).toHaveValue("My unsaved guidance");
  await page.reload();
  await page
    .getByText("Writing guidance and reusable prompts", { exact: true })
    .click();
  await expect(
    page.getByLabel("Project instructions", { exact: true }),
  ).toHaveValue("Writer's other tab");
});
test("checkpointed agent work resumes around a collaborating writer and exposes durable review and undo", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  await boot(page);
  const task = await submit(
    page,
    `Checkpoint collaboration ${crypto.randomUUID()}`,
  );
  await api("claim", {
    taskId: task.id,
    provider: "test",
    model: "scripted-collaboration",
  });
  const initial = await call(task.id, "context");
  const mutation = (revision: number, operationId: string, name: string) => ({
    songId: initial.songId,
    expectedRevision: revision,
    operationId,
    label: name,
    command: {
      kind: "edit",
      changes: [
        {
          table: "markers",
          id: operationId,
          value: { id: operationId, name, at: [1, 3] },
        },
      ],
    },
  });
  expect(
    (
      await call(
        task.id,
        "mutate",
        mutation(initial.revision, "first-marker", "First checkpoint marker"),
      )
    ).ok,
  ).toBe(true);
  const items = [
    {
      id: "first",
      title: "First marker",
      status: "completed",
      note: "Verified",
    },
    { id: "reply", title: "Reply marker", status: "pending", note: "" },
  ];
  await api("checkpoint", {
    taskId: task.id,
    expectedVersion: 0,
    checkpoint: {
      summary: "First marker saved",
      nextStep: "Reconcile writer and add reply",
      items,
    },
  });
  await api("finish", {
    taskId: task.id,
    status: "waiting",
    summary: "Checkpoint ready for interruption",
  });
  const card = page.locator(`[data-task-id="${task.id}"]`);
  await expect(card).toContainText("1/2 work items complete");
  const other = await context.newPage();
  await other.goto("/");
  await other.waitForFunction(() => Boolean((window as any).songwriting));
  const current = await tool(other, "context");
  await tool(other, "mutate", {
    songId: current.songId,
    expectedRevision: current.revision,
    operationId: "writer-title",
    label: "Writer title",
    command: {
      kind: "edit",
      changes: [
        { table: "meta", id: "title", value: "A writer's intervening title" },
      ],
    },
  });
  await page.reload();
  await expect(card).toContainText("First marker saved");
  await card.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(card).toContainText("PENDING");
  await api("claim", {
    taskId: task.id,
    provider: "test",
    model: "scripted-resume",
  });
  expect(
    (
      await call(
        task.id,
        "mutate",
        mutation(initial.revision, "reply-marker", "Reply marker"),
      )
    ).error,
  ).toContain("context");
  const fresh = await call(task.id, "context");
  expect(fresh.revision).toBe(current.revision + 1);
  expect(
    (
      await call(
        task.id,
        "mutate",
        mutation(initial.revision, "reply-marker", "Reply marker"),
      )
    ).ok,
  ).toBe(false);
  await expect(card).toContainText("Revision conflict");
  expect(
    (
      await call(
        task.id,
        "mutate",
        mutation(fresh.revision, "reply-marker", "Reply marker"),
      )
    ).ok,
  ).toBe(true);
  await api("checkpoint", {
    taskId: task.id,
    expectedVersion: 1,
    checkpoint: {
      summary: "Both markers verified; writer title preserved",
      nextStep: "",
      items: items.map((i) => ({ ...i, status: "completed" })),
    },
  });
  await api("finish", {
    taskId: task.id,
    status: "completed",
    summary: "Collaborative edits verified",
  });
  await expect(card).toContainText("2/2 work items complete");
  const review = card
    .locator("details")
    .filter({
      has: page.getByText("Review change: Reply marker · revision", {
        exact: false,
      }),
    })
    .first();
  await card.getByText(/Review change: Reply marker/).click();
  await review.getByRole("button", { name: "Undo this task change" }).click();
  await expect
    .poll(async () => (await tool(page, "read")).tables.markers["reply-marker"])
    .toBeUndefined();
  expect((await tool(page, "read")).title).toBe("A writer's intervening title");
  expect(
    (await tool(page, "read")).tables.markers["first-marker"],
  ).toBeDefined();
  const info = await api(`task_info?taskId=${task.id}`);
  expect(info.snapshot.revision).toBe(initial.revision);
  expect(info.steps.some((s: any) => s.result)).toBe(false);
});
