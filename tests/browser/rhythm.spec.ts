import { test, expect, type Page } from "@playwright/test";
import { acceptance } from "../acceptance.ts";
const tool = (page: Page, name: string, args: unknown = {}) =>
  page.evaluate(
    async ({ name, args }) => (window as any).songwriting.tool(name, args),
    { name, args },
  );
async function boot(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  await tool(page, "import", {
    text: JSON.stringify(acceptance()),
    asCopy: false,
  });
  // Reproduce fast-runner reads racing an asynchronous UI save.
  await page.evaluate(() => {
    const c = (window as any).songwriting.controller;
    const mutate = c.mutate.bind(c);
    c.mutate = async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return mutate(...args);
    };
  });
}
async function transform(page: Page, action: string) {
  await page.getByLabel("Transformation", { exact: true }).selectOption(action);
}
async function apply(page: Page) {
  await page
    .getByRole("button", { name: "Preview rhythm edit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply rhythm edit", exact: true })
    .click();
  await expect(page.getByLabel("Rhythm edit preview")).toHaveCount(0);
}
test("ordinary rhythm controls create an isolated A′, transform and compare it, then undo and reload", async ({
  page,
}) => {
  await boot(page);
  const original = await tool(page, "read");
  await page.getByLabel("Rhythm pattern").selectOption("seven");
  await page.getByLabel("Variation name").fill("Seven return");
  await apply(page);
  let s = await tool(page, "read");
  const p: any = Object.values(s.tables.patterns).find(
    (p: any) => p.name === "Seven return",
  );
  await transform(page, "scale");
  await page.getByLabel("Rhythm pattern").selectOption(p.id);
  await page.getByLabel("Scale factor").fill("2/3");
  await page.getByLabel("Note releases").selectOption("preserve");
  await apply(page);
  s = await tool(page, "read");
  expect(s.tables.patterns[p.id].length).toEqual([7, 3]);
  expect(s.tables.events.chord).toEqual(original.tables.events.chord);
  expect(s.tables.chords.tonic).toEqual(original.tables.chords.tonic);
  await page.getByText("Compare A / A′", { exact: true }).click();
  await page.getByLabel("Compare source").selectOption("seven");
  await page.getByLabel("Compare variation").selectOption(p.id);
  await page
    .getByRole("button", { name: "Compare patterns", exact: true })
    .click();
  await expect(page.getByLabel("Pattern comparison")).toContainText(
    "cycle 7/2 → 7/3",
  );
  await expect(page.getByLabel("Pattern comparison")).toContainText(
    "performance",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await tool(page, "read")).tables.patterns[p.id].length)
    .toEqual([7, 2]);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(async () => (await tool(page, "read")).tables.patterns[p.id].length)
    .toEqual([7, 3]);
  await transform(page, "rotate");
  await page.getByLabel("Rhythm pattern").selectOption(p.id);
  await page.getByLabel("Amount · quarter notes", { exact: true }).fill("-1/3");
  await apply(page);
  await transform(page, "accents");
  await page.getByLabel("Rhythm pattern").selectOption(p.id);
  await apply(page);
  await transform(page, "splice");
  await page.getByLabel("Rhythm pattern").selectOption(p.id);
  await page.getByLabel("Splice position").fill("1");
  await page.getByLabel("Amount · quarter notes", { exact: true }).fill("1/3");
  await apply(page);
  await transform(page, "phase");
  await page.getByLabel("Rhythm placement").selectOption("guitar");
  await page.getByLabel("Amount · quarter notes", { exact: true }).fill("-1/3");
  await apply(page);
  await transform(page, "displace");
  await page.getByLabel("Rhythm placement").selectOption("guitar");
  await page.getByLabel("Amount · quarter notes", { exact: true }).fill("1/2");
  await apply(page);
  s = await tool(page, "read");
  expect(s.tables.occurrences.guitar.phase).toEqual([19, 6]);
  expect(s.tables.occurrences.guitar.start).toEqual([1, 2]);
  expect(s.tables.occurrences.bass).toEqual(original.tables.occurrences.bass);
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  expect(JSON.parse(await tool(page, "export"))).toEqual(s);
});
test("polyrhythm forms generate audible independent lanes and inspectors expose intended-grid drift", async ({
  page,
}) => {
  await boot(page);
  await page.getByText("Build a polyrhythm", { exact: true }).click();
  await page.getByLabel("Lane 1 voice").selectOption("high");
  await page.getByLabel("Lane 2 voice").selectOption("drums");
  await page
    .getByRole("button", { name: "Preview polyrhythm", exact: true })
    .click();
  await expect(page.getByLabel("Rhythm edit preview")).toContainText("created");
  await page
    .getByRole("button", { name: "Apply rhythm edit", exact: true })
    .click();
  await expect(page.getByLabel("Rhythm edit preview")).toHaveCount(0);
  let s = await tool(page, "read");
  const p: any = Object.values(s.tables.polyrhythms)[0];
  await page.getByText("Inspect polyrhythm grids", { exact: true }).click();
  await page
    .getByRole("button", { name: "Show pulse grid", exact: true })
    .click();
  await expect(page.getByLabel("Polyrhythm grid")).toContainText(
    "Matches declared grid",
  );
  await tool(page, "select", { table: "polyrhythms", id: p.id });
  await page.getByLabel("Grid lane 1 divisions").fill("5");
  await page.getByRole("button", { name: "Save grid", exact: true }).click();
  await expect(page.getByLabel("Polyrhythm grid")).toContainText(
    "Differs from declared grid",
  );
  const pid = s.tables.occurrences[p.lanes[0].occurrenceId].patternId;
  await tool(page, "select", { table: "patterns", id: pid });
  await page.getByLabel("Pattern groups", { exact: true }).fill("1, 1, 2");
  await page.getByLabel("Pattern groups", { exact: true }).press("Tab");
  await expect
    .poll(async () => (await tool(page, "read")).tables.patterns[pid].groups)
    .toEqual([
      [1, 1],
      [1, 1],
      [2, 1],
    ]);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).songwriting.controller.audio.outputLevel,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  s = await tool(page, "read");
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  expect(JSON.parse(await tool(page, "export"))).toEqual(s);
  const copy = await tool(page, "import", {
    text: JSON.stringify(s),
    asCopy: true,
  });
  expect(copy.ok).toBe(true);
  expect((await tool(page, "read")).tables.polyrhythms).toEqual(
    s.tables.polyrhythms,
  );
});
test("alignment map marks exact shared starts and stale rhythm previews cannot overwrite an agent edit", async ({
  page,
  context,
}) => {
  await boot(page);
  await page.getByText("Find cycle alignments", { exact: true }).click();
  await page.getByLabel("Align Seven steps", { exact: true }).check();
  await page.getByLabel("Align Steady eight", { exact: true }).check();
  await page.getByLabel("Alignment until").fill("32");
  await page
    .getByRole("button", { name: "Show alignments", exact: true })
    .click();
  await expect(page.getByLabel("Cycle alignment map")).toContainText(
    "2 shared cycle starts",
  );
  await page.getByRole("button", { name: "Mark 28 q", exact: true }).click();
  await expect(page.locator(".marker-lane")).toContainText("Together");
  await transform(page, "scale");
  await page.getByLabel("Rhythm pattern").selectOption("seven");
  await page
    .getByRole("button", { name: "Preview rhythm edit", exact: true })
    .click();
  await expect(page.getByLabel("Rhythm edit preview")).toContainText(
    "Affected placements: Seven steps",
  );
  const other = await context.newPage();
  await other.goto("/");
  await other.waitForFunction(() => Boolean((window as any).songwriting));
  const ctx = await tool(other, "context");
  expect(
    (
      await tool(other, "mutate", {
        songId: ctx.songId,
        expectedRevision: ctx.revision,
        operationId: "foreign-phase3",
        label: "Agent changes title",
        command: {
          kind: "edit",
          changes: [{ table: "meta", id: "title", value: "Agent working" }],
        },
      })
    ).ok,
  ).toBe(true);
  await expect(page.getByLabel("Rhythm edit preview")).toContainText(
    "Song changed since this preview",
  );
  await expect(
    page.getByRole("button", { name: "Apply rhythm edit", exact: true }),
  ).toBeDisabled();
  expect((await tool(page, "read")).tables.patterns.seven.length).toEqual([
    7, 2,
  ]);
  await other.close();
});
