import "fake-indexeddb/auto";
import { expect, it } from "bun:test";
import { openDb, commit, read } from "./projects.ts";
import { emptySong } from "../song/model.ts";
import type { Mutation, Envelope } from "../song/commands.ts";
it("atomically rejects competing revisions and deduplicates a lost response across connections", async () => {
  const name = crypto.randomUUID(),
    a = await openDb(name),
    b = await openDb(name);
  const create: Mutation = {
    songId: "s",
    expectedRevision: 0,
    operationId: "first",
    label: "Create",
    command: { kind: "replace", song: emptySong("s") },
  };
  expect((await commit(a, create)).ok).toBe(true);
  const one: Mutation = {
    ...create,
    expectedRevision: 1,
    operationId: "one",
    command: {
      kind: "edit",
      changes: [{ table: "meta", id: "title", value: "One" }],
    },
  };
  const two: Mutation = {
    ...one,
    operationId: "two",
    command: {
      kind: "edit",
      changes: [{ table: "meta", id: "title", value: "Two" }],
    },
  };
  const results = await Promise.all([commit(a, one), commit(b, two)]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect((await commit(b, one)).ok).toBe(true);
  expect((await read<Envelope>(a, "songs", "s"))!.revision).toBe(2);
  expect((await commit(b, { ...one, label: "changed reuse" })).ok).toBe(false);
  a.close();
  b.close();
  const reopened = await openDb(name);
  expect((await read<Envelope>(reopened, "songs", "s"))!.song!.title).toBe(
    "One",
  );
  reopened.close();
});

it("loads a schema 1 database in place and preserves old retries and undo across reopen", async () => {
  const { acceptance } = await import("../../tests/acceptance.ts");
  const { applyCommand } = await import("../song/commands.ts");
  const { save, read } = await import("./projects.ts");
  const name = crypto.randomUUID();
  let db = await openDb(name);
  const song: any = acceptance("legacy");
  song.schemaVersion = 1;
  delete song.tables.phrases;
  delete song.tables.lyrics;
  delete song.tables.polyrhythms;
  for (const e of Object.values(song.tables.patterns) as any[]) delete e.groups;
  for (const e of Object.values(song.tables.events) as any[]) delete e.originId;
  for (const e of Object.values(song.tables.sections) as any[])
    delete e.sourceId;
  for (const e of Object.values(song.tables.occurrences) as any[])
    delete e.sectionId;
  const m = {
    songId: song.id,
    expectedRevision: 0,
    operationId: "legacy-import",
    label: "Legacy import",
    command: { kind: "replace" as const, song },
  };
  const envelope: any = applyCommand(undefined, m, 1);
  envelope.song = song;
  for (const d of envelope.history[0].deltas)
    if (d.after && typeof d.after === "object") {
      if (d.table === "patterns") delete d.after.groups;
      if (d.table === "events") delete d.after.originId;
      if (d.table === "sections") delete d.after.sourceId;
      if (d.table === "occurrences") delete d.after.sectionId;
    }
  await save(db, "songs", envelope);
  db.close();
  db = await openDb(name);
  const loaded = await read<any>(db, "songs", song.id);
  expect(loaded.song.schemaVersion).toBe(3);
  expect(loaded.song.tables.occurrences.guitar.sectionId).toBe(null);
  const duplicate = await commit(db, m);
  expect(duplicate.ok && duplicate.value.revision).toBe(1);
  const undo = await commit(db, {
    songId: song.id,
    expectedRevision: 1,
    operationId: "undo-legacy",
    label: "Undo import",
    command: { kind: "undo", targetId: "legacy-import" },
  });
  expect(undo.ok && undo.value.song).toBe(null);
  db.close();
});
