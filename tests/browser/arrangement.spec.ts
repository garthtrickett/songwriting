import { test, expect, type Page } from "@playwright/test";
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
  });
}
test("ordinary arrangement controls build A–B–A′ and save phrases, lyrics and entrances", async ({
  page,
}) => {
  await boot(page);
  const original = await tool(page, "read");
  await page
    .getByRole("button", { name: "Select section 1: A", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Repeat section", exact: true })
    .click();
  await expect(page.getByLabel("Structural edit preview")).toContainText(
    "1 global placements stay fixed",
  );
  await page.getByRole("button", { name: "Apply structural edit" }).click();
  await expect(page.locator(".section-card")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Select section 2: A", exact: true })
    .click();
  await page.getByRole("button", { name: "Later →", exact: true }).click();
  await page.getByRole("button", { name: "Apply structural edit" }).click();
  await page
    .getByRole("button", { name: "Select section 3: A", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Make section variation", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply structural edit" }).click();
  await expect(page.locator(".section-card").last()).toContainText("A′");
  await page.locator(".annotation.lyrics").last().click();
  await page
    .getByLabel("Lyric text", { exact: true })
    .fill("The return\ntakes another shape");
  await page.getByRole("button", { name: "Save lyrics", exact: true }).click();
  await expect(page.locator(".annotation.lyrics").last()).toContainText(
    "The return",
  );
  await page
    .getByRole("button", { name: "Select section 3: A′", exact: true })
    .click();
  await page.getByRole("button", { name: "+ Entrance", exact: true }).click();
  await page.getByLabel("Repeat span", { exact: true }).fill("31/2");
  await page.getByLabel("Repeat span", { exact: true }).press("Tab");
  await page.getByLabel("Start · quarter notes", { exact: true }).fill("1/2");
  await page.getByLabel("Start · quarter notes", { exact: true }).press("Tab");
  await page.getByLabel("At the end").selectOption("cut");
  await expect
    .poll(async () =>
      Object.values((await tool(page, "read")).tables.occurrences).some(
        (o: any) =>
          o.name === "Section entrance" &&
          o.start[1] === 2 &&
          o.tails === "cut",
      ),
    )
    .toBe(true);
  const s = await tool(page, "read");
  expect(s.tables.lyrics.words).toEqual(original.tables.lyrics.words);
  expect(s.tables.events).toMatchObject(original.tables.events);
  expect(s.tables.occurrences.bass).toEqual(original.tables.occurrences.bass);
  expect(
    Object.values(s.tables.occurrences).some(
      (o: any) =>
        o.name === "Section entrance" && o.start[1] === 2 && o.tails === "cut",
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator(".section-card")).toHaveCount(3);
  await expect(page.locator(".annotation.lyrics").last()).toContainText(
    "The return",
  );
  expect(JSON.parse(await tool(page, "export"))).toEqual(s);
});
test("keyboard editing ignores lyrics, nudges exact time, and supports undo/redo without navigation saves", async ({
  page,
}) => {
  await boot(page);
  await page.locator(".annotation.lyrics").first().click();
  const revision = (await tool(page, "context")).revision;
  await page.getByLabel("Lyric text", { exact: true }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  expect((await tool(page, "context")).revision).toBe(revision);
  expect((await tool(page, "context")).transport.playing).toBe(false);
  await tool(page, "select", { table: "events", id: "melody" });
  await page.getByLabel("Nudge step").fill("1/3");
  await page.getByLabel("Nudge step").press("Tab");
  await page.getByLabel("Song timeline", { exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(
      async () =>
        (await tool(page, "read", { table: "events", id: "melody" })).start,
    )
    .toEqual([11, 6]);
  await page.keyboard.press("Control+z");
  await expect
    .poll(
      async () =>
        (await tool(page, "read", { table: "events", id: "melody" })).start,
    )
    .toEqual([3, 2]);
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(
      async () =>
        (await tool(page, "read", { table: "events", id: "melody" })).start,
    )
    .toEqual([11, 6]);
  const before = (await tool(page, "context")).revision;
  await page.getByRole("button", { name: "Fit song", exact: true }).click();
  await page
    .getByRole("button", { name: "Select section 2: B", exact: true })
    .click();
  expect((await tool(page, "context")).revision).toBe(before);
  await expect
    .poll(async () =>
      page.locator(".score-scroll").evaluate((el) => el.scrollLeft),
    )
    .toBeGreaterThan(0);
});
test("incoming agent changes reject stale structural previews and preserve unsaved lyric drafts", async ({
  page,
  context,
}) => {
  await boot(page);
  const other = await context.newPage();
  await other.goto("/");
  await other.waitForFunction(() => Boolean((window as any).songwriting));
  await page
    .getByRole("button", { name: "Select section 1: A", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Repeat section", exact: true })
    .click();
  await page.locator(".annotation.lyrics").first().click();
  await page.getByLabel("Lyric text", { exact: true }).fill("My unsaved words");
  const ctx = await tool(other, "context");
  const r = await tool(other, "mutate", {
    songId: ctx.songId,
    expectedRevision: ctx.revision,
    operationId: "agent-lyric",
    label: "Agent lyric change",
    command: {
      kind: "edit",
      changes: [
        {
          table: "lyrics",
          id: "words",
          value: {
            ...arrangementSong().tables.lyrics.words,
            text: "Agent words",
          },
        },
      ],
    },
  });
  expect(r.ok).toBe(true);
  await expect(page.locator(".incoming")).toContainText("Agent lyric change");
  await expect(page.getByLabel("Lyric text", { exact: true })).toHaveValue(
    "My unsaved words",
  );
  await page.getByRole("button", { name: "Apply structural edit" }).click();
  await expect(page.getByRole("alert")).toContainText("Revision conflict");
  await expect(page.locator(".section-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Save lyrics", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Revision conflict");
  expect(
    (await tool(page, "read", { table: "lyrics", id: "words" })).text,
  ).toBe("Agent words");
  await expect(page.getByLabel("Lyric text", { exact: true })).toHaveValue(
    "My unsaved words",
  );
  await page
    .getByRole("button", { name: "Reload saved lyrics", exact: true })
    .click();
  await expect(page.getByLabel("Lyric text", { exact: true })).toHaveValue(
    "Agent words",
  );
});
test("a fresh writer can create sections, bars, phrases and lyrics with no JSON", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a song" }).click();
  await page.getByRole("button", { name: "+ Section", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Bar in section", exact: true })
    .click();
  await page.getByRole("button", { name: "+ Phrase", exact: true }).click();
  await page.getByLabel("Span duration", { exact: true }).fill("7/2");
  await page.getByLabel("Span duration", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "+ Lyric", exact: true }).click();
  await page.getByLabel("Span duration", { exact: true }).fill("3");
  await page.getByLabel("Span duration", { exact: true }).press("Tab");
  const phrase = Object.values(
    (await tool(page, "read")).tables.phrases,
  )[0] as any;
  // Keep this writer's field save in flight while they type and submit words.
  await page.evaluate(() => {
    const c = (window as any).songwriting.controller;
    const mutate = c.mutate.bind(c);
    c.mutate = async (...args: unknown[]) => {
      await new Promise(resolve => setTimeout(resolve, 250));
      return mutate(...args);
    };
  });
  await page.getByLabel("Phrase", { exact: true }).selectOption(phrase.id);
  await page
    .getByLabel("Lyric text", { exact: true })
    .fill("One more\nunexpected turn");
  await page.getByRole("button", { name: "Save lyrics", exact: true }).click();
  await expect(page.locator(".annotation.lyrics")).toContainText(
    "unexpected turn",
  );
  await page.reload();
  await expect(page.locator(".ruler-body button")).toHaveCount(2);
  await expect(page.locator(".annotation.phrases")).toHaveCount(1);
  await expect(page.locator(".annotation.lyrics")).toContainText(
    "unexpected turn",
  );
});

test("typing a title survives a same-revision repaint before blur", async ({
  page,
}) => {
  await boot(page);
  await page.getByLabel("Song title").fill("A title in progress");
  await tool(page, "navigate", { zoom: 40 });
  await expect(page.getByLabel("Song title")).toHaveValue(
    "A title in progress",
  );
  await page.getByLabel("Song title").press("Tab");
  await expect
    .poll(async () => (await tool(page, "read")).title)
    .toBe("A title in progress");
  await page.reload();
  await expect(page.getByLabel("Song title")).toHaveValue(
    "A title in progress",
  );
});

test("rapid inspector field edits compose before their first save completes", async ({
  page,
}) => {
  await boot(page);
  await tool(page, "select", { table: "occurrences", id: "guitar" });
  await page.evaluate(() => {
    for (const [label, value] of [
      ["Repeat span", "31/2"],
      ["Start · quarter notes", "1/2"],
    ]) {
      const input = document.querySelector<HTMLInputElement>(
        `input[aria-label="${label}"]`,
      )!;
      input.value = value!;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await expect
    .poll(async () => {
      const o = await tool(page, "read", {
        table: "occurrences",
        id: "guitar",
      });
      return [o.start, o.span];
    })
    .toEqual([
      [1, 2],
      [31, 2],
    ]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
