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
