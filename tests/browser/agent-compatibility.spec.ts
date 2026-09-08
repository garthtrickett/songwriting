import { test, expect } from "@playwright/test";

test("Send to agent supports older bridge tasks through polling and controls", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let task: Record<string, unknown> | undefined;
  let polls = 0;
  let malformed = false;
  await page.route("**/bridge/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/bridge/task") {
      const body = route.request().postDataJSON();
      task = {
        id: "legacy-task", clientId: body.clientId, songId: body.songId,
        prompt: body.prompt, status: "pending", summary: "Waiting for an agent",
        provider: "", model: "", createdAt: 1, steps: [],
      };
    }
    if (path === "/bridge/control") {
      expect(route.request().postDataJSON().id).toBe("legacy-task");
      task!.status = "cancelled";
    }
    if (path === "/bridge/poll") polls++;
    await route.fulfill({ json: path === "/bridge/status"
      ? { tasks: malformed ? [{ ...task, checkpoint: { items: null } }] : task ? [task] : [] }
      : path === "/bridge/poll" ? [] : task });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start a song" }).click();
  await expect(page.getByLabel("Song title")).toHaveValue("First sketch");
  await page.getByRole("button", { name: "Toggle agent panel", exact: true }).click();
  await page.getByLabel("Agent request").fill("Develop a 7/8 guitar reply");
  await page.getByRole("button", { name: "Send to agent" }).click();
  const card = page.locator('[data-task-id="legacy-task"]');
  await expect(card).toContainText("Develop a 7/8 guitar reply");
  await expect(page.getByLabel("Agent request")).toHaveValue("");
  const afterSubmit = polls;
  await expect.poll(() => polls).toBeGreaterThan(afterSubmit + 1);
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card).toContainText("CANCELLED");
  await expect(page.getByRole("button", { name: "Send to agent" })).toBeEnabled();
  malformed = true;
  await expect(page.getByRole("button", { name: "Send to agent" })).toBeDisabled();
  await expect(card).toContainText("CANCELLED");
  await page.getByLabel("Song title").fill("Still writing during recovery");
  await page.getByLabel("Song title").press("Tab");
  await expect.poll(() => page.evaluate(() => (window as any).songwriting.controller.song.title))
    .toBe("Still writing during recovery");
  malformed = false;
  task!.summary = "Connection recovered";
  task!.steps = [{ id: "read", name: "context", status: "done" }];
  await expect(card).toContainText("Connection recovered");
  await expect(card).toContainText("context done");
  await expect(page.getByRole("button", { name: "Send to agent" })).toBeEnabled();
  expect(errors).toEqual([]);
});
