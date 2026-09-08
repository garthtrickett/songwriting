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
  await page.getByRole("button", { name: "Open Notes", exact: true }).click();
}
const note = (page: Page, id: string) =>
  page.locator(`.degree-note[data-note-key="${id}"]`);

test("relative editor edits exact notes, spells alterations and keeps degrees unchanged across audition keys", async ({
  page,
}) => {
  await boot(page);
  await note(page, "melody/").click();
  await page.getByLabel("Editor start", { exact: true }).fill("1/3");
  await page.getByLabel("Editor duration", { exact: true }).fill("2/7");
  await page.getByLabel("Editor degree", { exact: true }).fill("7");
  await page.getByLabel("Editor alteration", { exact: true }).fill("-1");
  await page.getByLabel("Editor octave", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Apply note fields", exact: true })
    .click();
  await expect
    .poll(async () => (await tool(page, "read")).tables.events.melody)
    .toMatchObject({
      start: [1, 3],
      duration: [2, 7],
      pitch: { degree: 7, alteration: -1, octave: 0 },
    });
  await expect(note(page, "melody/")).toContainText("♭7");
  const saved = await tool(page, "read");
  await page.getByLabel("Playback key").selectOption("53");
  expect((await tool(page, "read")).tables.events).toEqual(saved.tables.events);
  await page
    .getByRole("button", { name: "Return to song", exact: true })
    .click();
  await expect(page.getByLabel("Song timeline", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open Notes", exact: true }).click();
  await expect(note(page, "melody/")).toContainText("♭7");
  await page.reload();
  await page.getByRole("button", { name: "Open Notes", exact: true }).click();
  expect((await tool(page, "read")).tables.events).toEqual(saved.tables.events);
});

test("draw, drag, resize, keyboard and undo use exact time and one receipt per gesture", async ({
  page,
}) => {
  await boot(page);
  await page.getByLabel("Note snap increment").fill("1/3");
  await page.getByLabel("Note snap increment").press("Tab");
  await page.getByRole("button", { name: "Add degree 1", exact: true }).click();
  let s = await tool(page, "read");
  const id = Object.keys(s.tables.events).find(
    (id) => !acceptance().tables.events[id],
  )!;
  const block = note(page, id + "/");
  await block.scrollIntoViewIfNeeded();
  const before = (await tool(page, "context")).revision;
  let b = (await block.boundingBox())!;
  await page.mouse.move(b.x + 4, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 28, b.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await tool(page, "read")).tables.events[id].start)
    .toEqual([1, 3]);
  expect((await tool(page, "context")).revision).toBe(before + 1);
  b = (await block.boundingBox())!;
  await page.mouse.move(b.x + b.width - 2, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 22, b.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await tool(page, "read")).tables.events[id].duration)
    .toEqual([2, 3]);
  await block.focus();
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(async () => (await tool(page, "read")).tables.events[id].pitch.degree)
    .toBe(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await tool(page, "read")).tables.events[id].pitch.degree)
    .toBe(1);
  // Escape discards a pointer preview without creating another revision.
  await block.scrollIntoViewIfNeeded();
  b = (await block.boundingBox())!;
  const revision = (await tool(page, "context")).revision;
  await page.mouse.move(b.x + 4, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 52, b.y + 10);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await tool(page, "context")).revision).toBe(revision);
});

test("member edits preserve sibling releases and dirty drafts survive closed panels and foreign changes", async ({
  page,
  context,
}) => {
  await boot(page);
  const original = await tool(page, "read");
  await note(page, "chord/third").click();
  await page.getByLabel("Editor duration", { exact: true }).fill("5/7");
  await page.getByRole("button", { name: "Open Rhythm", exact: true }).click();
  await page.getByRole("button", { name: "Open Notes", exact: true }).click();
  await expect(page.getByLabel("Editor duration", { exact: true })).toHaveValue(
    "5/7",
  );
  const other = await context.newPage();
  await other.goto("/");
  await other.waitForFunction(() => Boolean((window as any).songwriting));
  const current = await tool(other, "context");
  await tool(other, "mutate", {
    songId: current.songId,
    expectedRevision: current.revision,
    operationId: "foreign-note-test",
    label: "Writer title change",
    command: {
      kind: "edit",
      changes: [{ table: "meta", id: "title", value: "Writer title" }],
    },
  });
  await expect(page.getByLabel("Song title")).toHaveValue("Writer title");
  await page
    .getByRole("button", { name: "Apply note fields", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Revision conflict");
  await expect(page.getByLabel("Editor duration", { exact: true })).toHaveValue(
    "5/7",
  );
  expect((await tool(page, "read")).tables.events).toEqual(
    original.tables.events,
  );
  await page
    .getByRole("button", { name: "Reload note fields", exact: true })
    .click();
  await page.getByLabel("Editor duration", { exact: true }).fill("5/7");
  await page
    .getByRole("button", { name: "Apply note fields", exact: true })
    .click();
  await expect
    .poll(
      async () => (await tool(page, "read")).tables.events.chord.performance,
    )
    .toEqual([{ memberId: "third", offset: [1, 2], duration: [5, 7] }]);
  expect((await tool(page, "read")).tables.events.pedal).toEqual(
    original.tables.events.pedal,
  );
});

test("arrangement stays visible, panels do not dirty music, and compact layouts remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boot(page);
  const rev = (await tool(page, "context")).revision;
  await page
    .getByRole("button", { name: "Return to song", exact: true })
    .click();
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 720, height: 450 }, // CSS viewport equivalent of 1440×900 at 200% browser zoom.
  ]) {
    await page.setViewportSize(size);
    const area = await page
      .getByLabel("Song timeline", { exact: true })
      .boundingBox();
    expect(area!.y).toBeLessThan(300);
    expect(area!.height).toBeGreaterThan(180);
    expect(
      await page.evaluate(() => document.body.scrollWidth),
    ).toBeLessThanOrEqual(size.width);
    await page.getByRole("button", { name: "Open Notes", exact: true }).click();
    await expect(
      page.getByLabel("Relative note editor", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Return to song", exact: true })
      .click();
  }
  expect((await tool(page, "context")).revision).toBe(rev);
});

test("drawing uses degree lanes and a variation isolates shared notes and chords", async ({
  page,
}) => {
  await boot(page);
  const original = await tool(page, "read");
  await page
    .getByRole("button", { name: "Make variation", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await tool(page, "read")).tables.occurrences.guitar.patternId,
    )
    .not.toBe("seven");
  const s = await tool(page, "read"),
    pid = s.tables.occurrences.guitar.patternId;
  expect(s.tables.events.chord).toEqual(original.tables.events.chord);
  expect(s.tables.events.pedal).toEqual(original.tables.events.pedal);
  expect(s.tables.chords.tonic).toEqual(original.tables.chords.tonic);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const row = page
    .locator(".degree-row")
    .filter({
      has: page.locator(".degree-label").getByText("6", { exact: true }),
    })
    .locator(".degree-cell");
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  await page.mouse.click(box.x + 38, box.y + 12);
  await expect
    .poll(async () =>
      Object.values((await tool(page, "read")).tables.events).filter(
        (e: any) => e.patternId === pid && e.pitch.degree === 6,
      ),
    )
    .toHaveLength(1);
  const n: any = Object.values((await tool(page, "read")).tables.events).find(
    (e: any) => e.patternId === pid && e.pitch.degree === 6,
  );
  expect(n.start).toEqual([1, 2]);
  expect(n.pitch).toEqual({ degree: 6, alteration: 0, octave: 0 });
});

test("a concurrent agent change rejects a pointer edit without losing either the music or proposal", async ({
  page,
}) => {
  await boot(page);
  const block = note(page, "melody/");
  await block.scrollIntoViewIfNeeded();
  const box = (await block.boundingBox())!,
    original = (await tool(page, "read")).tables.events.melody;
  await page.mouse.move(box.x + 4, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 8);
  const ctx = await tool(page, "context");
  await tool(page, "mutate", {
    songId: ctx.songId,
    expectedRevision: ctx.revision,
    operationId: "during-gesture",
    label: "Agent edit during drag",
    command: {
      kind: "edit",
      changes: [
        { table: "meta", id: "title", value: "Agent title during drag" },
      ],
    },
  });
  await page.mouse.up();
  await expect(page.getByRole("alert")).toContainText("Revision conflict");
  expect((await tool(page, "read")).tables.events.melody).toEqual(original);
  await expect(page.getByLabel("Song title")).toHaveValue(
    "Agent title during drag",
  );
  await page.getByText(/Retained note edit ·/).click();
  await expect(
    page.getByLabel("Retained note edit", { exact: true }),
  ).toHaveValue(/Move notes/);
});
