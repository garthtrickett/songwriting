import { test, expect, type Page } from "@playwright/test";
import { frettedSong } from "../fretted.ts";
const tool = (page: Page, name: string, args: unknown = {}) =>
  page.evaluate(
    async ({ name, args }) => (window as any).songwriting.tool(name, args),
    { name, args },
  );
async function boot(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  await tool(page, "import", {
    text: JSON.stringify(frettedSong()),
    asCopy: false,
  });
  await page.evaluate(() => {
    const c = (window as any).songwriting.controller,
      original = c.mutate.bind(c);
    c.mutate = async (...args: unknown[]) => {
      await new Promise((r) => setTimeout(r, 100));
      return original(...args);
    };
  });
}
async function assign(page: Page, event: string, position: string) {
  await page
    .getByLabel("Note to finger", { exact: true })
    .selectOption(JSON.stringify(["line", event, null]));
  await page
    .getByRole("button", { name: "Find positions", exact: true })
    .click();
  await page.getByRole("button", { name: position, exact: true }).click();
  await page
    .getByRole("button", { name: "Apply fingering", exact: true })
    .click();
  await expect(
    page.getByLabel("Fingering preview", { exact: true }),
  ).toHaveCount(0);
}
test("ordinary string choices, connected techniques, retuning and undo preserve relative music and survive reload", async ({
  page,
}) => {
  await boot(page);
  const before = await tool(page, "read");
  await assign(page, "first", "String 2 · fret 3");
  let s = await tool(page, "read");
  const first = Object.values(s.tables.fingerings)[0] as any;
  await assign(page, "second", "String 2 · fret 5");
  await page.getByLabel("Technique", { exact: true }).selectOption("hammer-on");
  await page
    .getByLabel("Technique source", { exact: true })
    .selectOption(first.id);
  await page
    .getByRole("button", { name: "Save fingering", exact: true })
    .click();
  await expect
    .poll(async () =>
      Object.values((await tool(page, "read")).tables.fingerings).some(
        (f: any) => f.technique === "hammer-on",
      ),
    )
    .toBe(true);
  let tab = await tool(page, "tablature", {
    arrangementId: "drop",
    from: [0, 1],
    until: [8, 1],
  });
  expect(
    tab.rows
      .filter((n: any) => n.fingering)
      .every((n: any) => n.issues.length === 0),
  ).toBe(true);
  await page.getByRole("button", { name: "Edit tuning and capo" }).click();
  await page.getByLabel("Tuning preset").selectOption("DADGAD");
  await page.getByLabel("Capo", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save fretted arrangement" }).click();
  await expect
    .poll(async () => (await tool(page, "read")).tables.fretted.drop.capo)
    .toBe(2);
  // DADGAD's second string lowers by two, and capo raises by two: the assigned positions stay valid.
  tab = await tool(page, "tablature", {
    arrangementId: "drop",
    from: [0, 1],
    until: [8, 1],
  });
  expect(
    tab.rows
      .filter((n: any) => n.fingering)
      .every((n: any) => n.issues.length === 0),
  ).toBe(true);
  await page.getByLabel("Capo", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Save fretted arrangement" }).click();
  await expect
    .poll(async () => (await tool(page, "read")).tables.fretted.drop.capo)
    .toBe(3);
  await expect(page.getByLabel("Tab note details")).toContainText(
    "does not sound the current note",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await tool(page, "read")).tables.fretted.drop.capo)
    .toBe(2);
  s = await tool(page, "read");
  expect(s.tables.events).toEqual(before.tables.events);
  expect(s.tables.occurrences).toEqual(before.tables.occurrences);
  const exported = await tool(page, "export");
  await page.reload();
  await page.waitForFunction(() =>
    Boolean((window as any).songwriting?.controller.song),
  );
  expect(await tool(page, "export")).toBe(exported);
  await tool(page, "import", {
    text: exported,
    asCopy: true,
    operationId: "fretted-copy",
  });
  expect((await tool(page, "read")).tables.fingerings).toEqual(
    s.tables.fingerings,
  );
  await expect(page.getByLabel("Timed tablature")).toContainText("String 2");
});
test("foreign edits invalidate position previews and preserve tuning drafts", async ({
  page,
  context,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Edit tuning and capo" }).click();
  await page.getByLabel("Capo", { exact: true }).fill("4");
  await page
    .getByLabel("Note to finger", { exact: true })
    .selectOption(JSON.stringify(["line", "first", null]));
  await page
    .getByRole("button", { name: "Find positions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "String 2 · fret 3", exact: true })
    .click();
  const other = await context.newPage();
  await other.goto("/");
  await other.waitForFunction(() =>
    Boolean((window as any).songwriting?.controller.song),
  );
  const revision = await other.evaluate(
    () => (window as any).songwriting.controller.current.revision,
  );
  await tool(other, "mutate", {
    songId: "fretted-song",
    expectedRevision: revision,
    operationId: "foreign-fretted",
    label: "Foreign title",
    command: {
      kind: "edit",
      changes: [{ table: "meta", id: "title", value: "Edited elsewhere" }],
    },
  });
  await expect(
    page.getByRole("button", { name: "Apply fingering", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Capo", { exact: true })).toHaveValue("4");
  await page
    .getByRole("button", { name: "Save fretted arrangement", exact: true })
    .click();
  await expect
    .poll(async () => (await tool(page, "read")).tables.fretted.drop.capo)
    .toBe(0);
  await expect(page.getByLabel("Capo", { exact: true })).toHaveValue("4");
  await page
    .getByRole("button", { name: "Reload saved fingering settings" })
    .click();
  await expect(page.getByLabel("Capo", { exact: true })).toHaveValue("0");
  await other.close();
});
