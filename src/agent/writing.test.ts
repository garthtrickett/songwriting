import "fake-indexeddb/auto";
import { expect, it } from "bun:test";
import { Controller } from "../app/controller.ts";
import { openDb } from "../storage/projects.ts";
import { executeTool } from "./tools.ts";
import { validateSong } from "../song/validate.ts";
import { emptySong } from "../song/model.ts";
import { applyCommand } from "../song/commands.ts";
import { writingChanges, writingExport } from "./writing.ts";
it("schema six upgrades writing without touching music; customization is validated and portable", () => {
  const legacy: any = emptySong("old");
  legacy.schemaVersion = 6;
  delete legacy.writing;
  delete legacy.tables.prompts;
  const v = validateSong(legacy);
  expect(v.ok).toBe(true);
  if (!v.ok) return;
  expect(v.value.writing).toEqual({ instructions: "", preferences: "" });
  expect(v.value.tables.events).toEqual(legacy.tables.events);
  v.value.writing.instructions = "Keep the held bass";
  v.value.tables.prompts.reply = {
    id: "reply",
    name: "Reply",
    text: "Develop an independent reply",
  };
  const envelope = applyCommand(
    undefined,
    {
      songId: "old",
      expectedRevision: 0,
      operationId: "create",
      label: "Create",
      command: { kind: "replace", song: v.value },
    },
    1,
  );
  const imported = applyCommand(
    envelope,
    {
      songId: "old",
      expectedRevision: 1,
      operationId: "guidance",
      label: "Guidance",
      command: {
        kind: "edit",
        changes: writingChanges(v.value, writingExport(emptySong("other"))),
      },
    },
    2,
  );
  expect(imported.song!.tables.prompts).toEqual({});
  const undone = applyCommand(
    imported,
    {
      songId: "old",
      expectedRevision: 2,
      operationId: "undo",
      label: "Undo",
      command: { kind: "undo", targetId: "guidance" },
    },
    3,
  );
  expect(undone.song!.writing).toEqual(v.value.writing);
  expect(undone.song!.tables.prompts).toEqual(v.value.tables.prompts);
  v.value.writing.instructions = "x".repeat(8001);
  expect(validateSong(v.value).ok).toBe(false);
});
it("bounded summaries and search expose totals and reject stale continuation", async () => {
  const c = new Controller(await openDb(crypto.randomUUID()));
  try {
    await c.init();
    const s = emptySong("pages");
    for (let i = 0; i < 80; i++)
      s.tables.markers[`m${String(i).padStart(2, "0")}`] = {
        id: `m${String(i).padStart(2, "0")}`,
        name: `Marker ${i}`,
        at: [i, 1],
      };
    s.tables.prompts.p = {
      id: "p",
      name: "Long recipe",
      text: "secret body ".repeat(100),
    };
    await c.import(JSON.stringify(s), false, "initial");
    const ctx: any = await executeTool(c, "context", { limit: 5 });
    expect(ctx.counts.markers).toBe(80);
    expect(JSON.stringify(ctx)).not.toContain("secret body");
    const first: any = await executeTool(c, "search", {
      table: "markers",
      query: "Marker",
      limit: 5,
    });
    expect(first.items).toHaveLength(5);
    expect(first.nextOffset).toBe(5);
    expect(first.total).toBe(80);
    await c.patchTitle("Changed");
    await expect(
      executeTool(c, "search", {
        table: "markers",
        offset: 5,
        songId: "pages",
        expectedRevision: 1,
      }),
    ).rejects.toThrow("Context changed");
    await expect(executeTool(c, "context", { limit: 51 })).rejects.toThrow(
      "1–50",
    );
    const receipt: any = await executeTool(c, "receipt", {
      operationId: "initial",
    });
    expect(receipt.deltas.length).toBeGreaterThan(80);
  } finally {
    c.dispose();
  }
});
