import { test, expect, type Page } from "@playwright/test";
import { wav, mediaSong } from "../media.ts";
const tool = (page: Page, name: string, args: unknown = {}) =>
  page.evaluate(
    async ({ name, args }) => (window as any).songwriting.tool(name, args),
    { name, args },
  );
async function boot(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).songwriting));
  await tool(page, "import", {
    text: JSON.stringify(mediaSong()),
    asCopy: false,
  });
}
async function imported(page: Page) {
  await page
    .getByLabel("Import audio file", { exact: true })
    .setInputFiles({
      name: "Generated vocal idea.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from(wav(2)),
    });
  await expect(page.getByLabel("Audio to attach")).toContainText(
    "Generated vocal idea",
  );
}
async function attach(page: Page) {
  await page.getByLabel("Idea name", { exact: true }).fill("Vocal phrase");
  await page
    .getByLabel("Recording part", { exact: true })
    .selectOption("voice");
  await page.getByLabel("Recording placement scope").selectOption("a");
  await page.getByLabel("Recording placement start").fill("1/3");
  await page.getByRole("button", { name: "Preview take", exact: true }).click();
  await page.getByRole("button", { name: "Attach take", exact: true }).click();
  await expect(page.getByLabel("Take attachment preview")).toHaveCount(0);
}
test("audio import, ordinary take trims, bundle roundtrip and seek preserve composition and render actual audio", async ({
  page,
}) => {
  await boot(page);
  const before = await tool(page, "read");
  await imported(page);
  await attach(page);
  await page
    .getByLabel("Source offset · seconds", { exact: true })
    .fill("0.25");
  await page
    .getByLabel("Take duration · seconds", { exact: true })
    .fill("1.25");
  await page.getByRole("button", { name: "Save take", exact: true }).click();
  await expect
    .poll(async () =>
      Object.values((await tool(page, "read")).tables.takes).some(
        (t: any) => t.offset === 0.25 && t.duration === 1.25,
      ),
    )
    .toBe(true);
  await expect(page.locator(".recorded-take")).toContainText("Vocal phrase");
  const saved = await tool(page, "read");
  expect(saved.tables.events).toEqual(before.tables.events);
  expect(saved.tables.occurrences).toEqual(before.tables.occurrences);
  const bundle = await tool(page, "bundle_export");
  const parsed = JSON.parse(bundle);
  expect(parsed.assets).toHaveLength(1);
  expect(Buffer.from(parsed.assets[0].base64, "base64")).toEqual(
    Buffer.from(wav(2)),
  );
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).songwriting.controller.audio.scheduled.some(
          (n: any) => n.kind === "take",
        ),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).songwriting.controller.audio.outputLevel,
      ),
    )
    .toBeGreaterThan(0.0001);
  await tool(page, "transport", { action: "seek", position: 0.5 });
  expect(
    await page.evaluate(
      () => (window as any).songwriting.controller.audio.activeSources,
    ),
  ).toBe(0);
  await tool(page, "transport", { action: "play" });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).songwriting.controller.audio.scheduled.some(
          (n: any) => n.kind === "take",
        ),
      ),
    )
    .toBe(true);
  await tool(page, "transport", { action: "stop" });
  await page.reload();
  await page.waitForFunction(() =>
    Boolean((window as any).songwriting?.controller.song),
  );
  expect((await tool(page, "media_status")).missing).toEqual([]);
  await tool(page, "bundle_import", {
    text: bundle,
    asCopy: true,
    operationId: "media-copy",
  });
  expect((await tool(page, "read")).tables.takes).toEqual(saved.tables.takes);
  const missing = await page.context().browser()!.newContext();
  const other = await missing.newPage();
  await other.goto("/");
  await other.waitForFunction(() => Boolean((window as any).songwriting));
  await tool(other, "import", { text: JSON.stringify(saved), asCopy: false });
  expect((await tool(other, "media_status")).missing).toHaveLength(1);
  await expect(other.getByLabel("Recordings and media")).toContainText(
    "Missing audio",
  );
  await expect(tool(other, "bundle_export")).rejects.toThrow(
    "Missing audio asset",
  );
  await missing.close();
});
test("synthetic microphone capture saves final chunks, excludes another tab and releases tracks on stop", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  await boot(page);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(),
        dest = ctx.createMediaStreamDestination(),
        osc = ctx.createOscillator();
      osc.frequency.value = 220;
      osc.connect(dest);
      osc.start();
      await ctx.resume();
      (window as any).fixtureInputContext = ctx;
      return dest.stream;
    };
  });
  await page.getByLabel("Idea name", { exact: true }).fill("Captured idea");
  await page
    .getByLabel("Recording part", { exact: true })
    .selectOption("voice");
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.getByLabel("Recording status")).toContainText(
    "recording · 1",
  );
  const other = await context.newPage();
  await other.goto("/");
  await other.waitForFunction(() =>
    Boolean((window as any).songwriting?.controller.song),
  );
  await tool(other, "recording_start", {
    name: "Competing",
    partId: "voice",
    sectionId: null,
    start: [0, 1],
  });
  await expect
    .poll(async () => (await tool(other, "media_status")).recording.status)
    .toBe("failed");
  expect((await tool(other, "media_status")).recording.error).toContain(
    "Another tab",
  );
  await expect
    .poll(
      async () =>
        (await tool(page, "media_status")).captures.some(
          (c: any) => c.chunks > 0,
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(page.getByLabel("Recording status")).toContainText("ready · 0");
  const status = await tool(page, "media_status");
  expect(status.assets).toHaveLength(1);
  expect(status.assets[0].duration).toBeGreaterThan(0);
  expect(status.captures[0].assetId).toBe(status.assets[0].id);
  expect(status.captures[0].chunks).toBe(0);
  await page.reload();
  await page.waitForFunction(() =>
    Boolean((window as any).songwriting?.controller.song),
  );
  expect((await tool(page, "media_status")).captures[0].status).toBe("ready");
  await other.close();
});
test("permission denial and cancellation of a delayed grant never leave hidden microphone tracks", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    (window as any).originalGetUserMedia =
      navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied by test", "NotAllowedError");
    };
  });
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.getByLabel("Recording status")).toContainText("failed · 0");
  await expect(page.getByLabel("Recordings and media")).toContainText(
    "Denied by test",
  );
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        (window as any).grantLate = () => {
          const ctx = new AudioContext(),
            dest = ctx.createMediaStreamDestination();
          (window as any).lateStream = dest.stream;
          (window as any).lateContext = ctx;
          resolve(dest.stream);
        };
      });
  });
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.getByLabel("Recording status")).toContainText(
    "requesting · 0",
  );
  await page.waitForFunction(() => Boolean((window as any).grantLate));
  await page
    .getByRole("button", { name: "Cancel microphone request", exact: true })
    .click();
  await page.evaluate(() => (window as any).grantLate());
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).lateStream
          .getTracks()
          .every((t: MediaStreamTrack) => t.readyState === "ended"),
      ),
    )
    .toBe(true);
  expect((await tool(page, "media_status")).assets).toHaveLength(0);
  await page.evaluate(() => (window as any).lateContext.close());
});
test("recover persisted interrupted chunks and keep imported audio when a take preview becomes stale", async ({
  page,
  context,
}) => {
  await boot(page);
  const encoded = Buffer.from(wav(1)).toString("base64");
  await page.evaluate(async (encoded) => {
    const c = (window as any).songwriting.controller,
      bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    await new Promise<void>((resolve, reject) => {
      const tx = c.db.transaction("captures", "readwrite");
      tx.objectStore("captures").put({
        id: "interrupted",
        songId: c.song.id,
        revision: c.current.revision,
        name: "Interrupted fixture",
        partId: "voice",
        sectionId: null,
        start: [1, 3],
        status: "recording",
        mime: "audio/wav",
        chunks: [new Blob([bytes])],
        assetId: null,
        error: "",
        createdAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  }, encoded);
  await page.reload();
  await page.waitForFunction(() =>
    Boolean((window as any).songwriting?.controller.song),
  );
  await page
    .getByText("Local audio library and capture recovery", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recover Interrupted fixture", exact: true })
    .click();
  await expect(page.getByLabel("Audio to attach")).toContainText(
    "Interrupted fixture",
  );
  await page.getByRole("button", { name: "Preview take", exact: true }).click();
  const other = await context.newPage();
  await other.goto("/");
  await other.waitForFunction(() =>
    Boolean((window as any).songwriting?.controller.song),
  );
  const revision = await other.evaluate(
    () => (window as any).songwriting.controller.current.revision,
  );
  await tool(other, "mutate", {
    songId: "media-song",
    expectedRevision: revision,
    operationId: "foreign-media",
    label: "Incoming title",
    command: {
      kind: "edit",
      changes: [{ table: "meta", id: "title", value: "New title" }],
    },
  });
  await expect(
    page.getByRole("button", { name: "Attach take", exact: true }),
  ).toBeDisabled();
  expect((await tool(page, "media_status")).assets).toHaveLength(1);
  expect((await tool(page, "read")).tables.takes).toEqual({});
  await other.close();
});

test("failed audio-library save preserves captured chunks and explicit recovery retries without recording again", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(),
        dest = ctx.createMediaStreamDestination(),
        osc = ctx.createOscillator();
      osc.connect(dest);
      osc.start();
      await ctx.resume();
      (window as any).fixtureInputContext = ctx;
      return dest.stream;
    };
    const lib = (window as any).songwriting.controller.media.library;
    (window as any).originalStore = lib.store.bind(lib);
    lib.store = async () => {
      throw new DOMException("Disk full fixture", "QuotaExceededError");
    };
  });
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.getByLabel("Recording status")).toContainText(
    "recording · 1",
  );
  await expect
    .poll(
      async () =>
        (await tool(page, "media_status")).captures.some(
          (c: any) => c.chunks > 0,
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(page.getByLabel("Recording status")).toContainText("failed · 0");
  const failed = await tool(page, "media_status");
  expect(failed.assets).toHaveLength(0);
  expect(failed.captures[0].chunks).toBeGreaterThan(0);
  expect(failed.captures[0].status).toBe("interrupted");
  await page.evaluate(() => {
    (window as any).songwriting.controller.media.library.store = (
      window as any
    ).originalStore;
  });
  await tool(page, "capture_recover", { id: failed.captures[0].id });
  const ready = await tool(page, "media_status");
  expect(ready.assets).toHaveLength(1);
  expect(ready.captures[0].status).toBe("ready");
  expect(ready.recording.activeTracks).toBe(0);
  await page.evaluate(() => (window as any).fixtureInputContext.close());
});
