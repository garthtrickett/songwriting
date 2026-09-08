import { test, expect, type Page } from "@playwright/test";
import { harmonySong } from "../harmony.ts";
const tool = (page: Page, name: string, args: unknown = {}) =>
  page.evaluate(
    async ({ name, args }) => (window as any).songwriting.tool(name, args),
    { name, args },
  );
async function boot(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  await tool(page, "import", {
    text: JSON.stringify(harmonySong()),
    asCopy: false,
  });
  await page.getByRole("button", { name: "Open Harmony", exact: true }).click();
  await page.evaluate(() => {
    const c = (window as any).songwriting.controller,
      mutate = c.mutate.bind(c);
    c.mutate = async (...args: unknown[]) => {
      await new Promise((r) => setTimeout(r, 100));
      return mutate(...args);
    };
  });
}
async function apply(page: Page, button: string) {
  await page.getByRole("button", { name: button, exact: true }).click();
  await page
    .getByRole("button", { name: "Apply harmony edit", exact: true })
    .click();
  await expect(page.getByLabel("Harmony edit preview")).toHaveCount(0);
}
test("ordinary chord and context controls preserve pedal notes and portable contextual harmony", async ({
  page,
}) => {
  await boot(page);
  const before = await tool(page, "read");
  await page.getByText("Build relative chords", { exact: true }).click();
  await page.getByLabel("Chord name", { exact: true }).fill("Applied colour");
  await page.getByLabel("Roman root", { exact: true }).fill("V");
  await page.getByLabel("Applied target · optional").fill("V");
  await page.getByLabel("Extension", { exact: true }).selectOption("7");
  await page.getByLabel("Added or altered tones").fill("#11");
  await page.getByLabel("Omitted tones").fill("5");
  await page.getByLabel("Inversion", { exact: true }).fill("1");
  await page.getByLabel("Assign to chord event").selectOption("chord");
  await page.getByLabel("Existing member performance").selectOption("reset");
  await apply(page, "Preview chord");
  let s = await tool(page, "read");
  const chord = s.tables.chords[s.tables.events.chord.chordId];
  expect(chord.label).toContain("V7/V");
  expect(chord.label).toContain("no5");
  expect(chord.notes.some((n: any) => n.id === "tone-11")).toBe(true);
  expect(chord.notes.some((n: any) => n.id === "tone-5")).toBe(false);
  expect(s.tables.events.pedal).toEqual(before.tables.events.pedal);
  expect(s.tables.chords.tonic).toEqual(before.tables.chords.tonic);
  await page
    .getByRole("button", { name: "+ Harmonic region", exact: true })
    .click();
  await page.getByLabel("Harmonic scope").selectOption("verse");
  await page.getByLabel("Context start").fill("8");
  await page.getByLabel("Context duration").fill("4");
  await page.getByLabel("Context tonic degree").fill("4");
  await page.getByLabel("Context mode").fill("lydian");
  await page
    .getByRole("button", { name: "Save harmonic region", exact: true })
    .click();
  await expect(page.locator(".harmonic-region")).toContainText([
    "Dominant centre",
    "Local context",
    "Song context",
  ]);
  await expect
    .poll(async () =>
      Object.values((await tool(page, "read")).tables.harmony).some(
        (h: any) => h.tonic.degree === 4 && h.start[0] === 8,
      ),
    )
    .toBe(true);
  expect(
    (await tool(page, "harmonic_context", { at: [8, 1] })).tonic.degree,
  ).toBe(4);
  expect((await tool(page, "read")).tables.events).toEqual(s.tables.events);
  await page.getByText("Inspect sounding harmony", { exact: true }).click();
  await page.getByLabel("Harmony position").fill("1/3");
  await page
    .getByRole("button", { name: "Inspect sounding notes", exact: true })
    .click();
  await expect(page.getByLabel("Sounding harmony")).toContainText("Main voice");
  s = await tool(page, "read");
  await page.reload();
  await page.getByRole("button", { name: "Open Harmony", exact: true }).click();
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  expect(JSON.parse(await tool(page, "export"))).toEqual(s);
  expect(
    (await tool(page, "import", { text: JSON.stringify(s), asCopy: true })).ok,
  ).toBe(true);
});
test("voicing, transposition, member drafts and expression work through ordinary controls and audition", async ({
  page,
}) => {
  await boot(page);
  const before = await tool(page, "read");
  await page.getByText("Build relative chords", { exact: true }).click();
  await page.getByLabel("Chord name", { exact: true }).fill("Subdominant");
  await page.getByLabel("Roman root", { exact: true }).fill("IV");
  await apply(page, "Preview chord");
  let s = await tool(page, "read");
  const target: any = Object.values(s.tables.chords).find(
    (c: any) => c.name === "Subdominant",
  );
  await page.getByText("Compare voice motion", { exact: true }).click();
  await page.getByLabel("Motion source chord").selectOption("tonic");
  await page.getByLabel("Motion target chord").selectOption(target.id);
  await page
    .getByRole("button", { name: "Compare voice leading", exact: true })
    .click();
  await expect(page.getByLabel("Voice-leading comparison")).toContainText(
    "3 semitones",
  );
  await page.getByText("Develop voice leading", { exact: true }).click();
  await page.getByLabel("Voice-leading source").selectOption("tonic");
  await page.getByLabel("Voice-leading target").selectOption(target.id);
  await apply(page, "Preview voicing");
  expect((await tool(page, "read")).tables.chords[target.id].label).toBeNull();
  await page.getByText("Shape chord performance", { exact: true }).click();
  await page.getByLabel("Performance event").selectOption("chord");
  await page.getByLabel("Member attack step").fill("1/3");
  await apply(page, "Preview performance");
  await tool(page, "select", { table: "events", id: "chord" });
  await page.getByLabel("root duration", { exact: true }).fill("5/3");
  await page.getByLabel("root gain", { exact: true }).fill("0.8");
  await page
    .getByLabel("root articulation", { exact: true })
    .selectOption("staccato");
  await page
    .getByRole("button", { name: "Save member performance", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await tool(page, "read")).tables.events.chord.performance[0].gain,
    )
    .toBe(0.8);
  await page.getByText("Shape expression", { exact: true }).click();
  await page.getByLabel("Expression events").selectOption(["chord", "melody"]);
  await page.getByLabel("Duration factor").fill("1/2");
  await apply(page, "Preview expression");
  expect(
    (await tool(page, "read")).tables.events.chord.performance[0].duration,
  ).toEqual([5, 6]);
  await page.getByText("Transpose a pattern", { exact: true }).click();
  await page.getByLabel("Transpose pattern").selectOption("seven");
  await apply(page, "Preview transposition");
  s = await tool(page, "read");
  expect(s.tables.chords.tonic).toEqual(before.tables.chords.tonic);
  expect(s.tables.events.pedal).toEqual(before.tables.events.pedal);
  expect(s.tables.events.chord.performance[0].gain).toBe(0.8);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).songwriting.controller.audio.outputLevel,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await tool(page, "read")).tables.events.chord.chordId)
    .toBe("tonic");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(async () => (await tool(page, "read")).tables.events.chord.chordId)
    .toBe(s.tables.events.chord.chordId);
  await page.reload();
  await page.getByRole("button", { name: "Open Harmony", exact: true }).click();
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  expect(JSON.parse(await tool(page, "export"))).toEqual(s);
});
test("incoming edits preserve member and context drafts while rejecting stale previews and saves", async ({
  page,
  context,
}) => {
  await boot(page);
  await tool(page, "select", { table: "harmony", id: "local" });
  await page.getByLabel("Harmonic annotation").fill("My context draft");
  await tool(page, "select", { table: "events", id: "chord" });
  await page.getByLabel("root gain", { exact: true }).fill("0.3");
  await page.getByText("Build relative chords", { exact: true }).click();
  await page
    .getByRole("button", { name: "Preview chord", exact: true })
    .click();
  const other = await context.newPage();
  await other.goto("/");
  await other.waitForFunction(() => Boolean((window as any).songwriting));
  const ctx = await tool(other, "context");
  expect(
    (
      await tool(other, "mutate", {
        songId: ctx.songId,
        expectedRevision: ctx.revision,
        operationId: "phase4-foreign",
        label: "Agent title",
        command: {
          kind: "edit",
          changes: [
            { table: "meta", id: "title", value: "Agent changed title" },
          ],
        },
      })
    ).ok,
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Apply harmony edit", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("root gain", { exact: true })).toHaveValue(
    "0.3",
  );
  await page
    .getByRole("button", { name: "Save member performance", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Revision conflict");
  expect(
    (await tool(page, "read")).tables.events.chord.performance.some(
      (m: any) => m.gain === 0.3,
    ),
  ).toBe(false);
  await tool(page, "select", { table: "harmony", id: "local" });
  await expect(page.getByLabel("Harmonic annotation")).toHaveValue(
    "My context draft",
  );
  await page
    .getByRole("button", { name: "Save harmonic region", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Revision conflict");
  expect((await tool(page, "read")).tables.harmony.local.annotation).toBe(
    "Temporary focus",
  );
  await other.close();
});
