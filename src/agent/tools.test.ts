import "fake-indexeddb/auto";
import { it, expect } from "bun:test";
import { Controller } from "../app/controller.ts";
import { openDb } from "../storage/projects.ts";
import { executeTool } from "./tools.ts";
import { emptySong, TABLES, type Song } from "../song/model.ts";
import { acceptance } from "../../tests/acceptance.ts";
import type { Envelope } from "../song/commands.ts";
it("exposes complete entity CRUD through the same command model, including chords and markers", async () => {
  const c = new Controller(await openDb(crypto.randomUUID()));
  try {
    await c.init();
    const s = acceptance("parity");
    s.tables.markers.m = { id: "m", name: "Marker", at: [1, 1] };
    const created = (await executeTool(c, "mutate", {
      songId: s.id,
      expectedRevision: 0,
      operationId: "create",
      label: "Create all entities",
      command: { kind: "replace", song: s },
    })) as { ok: boolean; value: Envelope };
    expect(created.ok).toBe(true);
    await executeTool(c, "open_song", { id: s.id });
    for (const table of TABLES) {
      const entities = (await executeTool(c, "read", { table })) as Record<
        string,
        { id: string; name: string }
      >;
      expect(Object.keys(entities).length).toBeGreaterThan(0);
      const entity = Object.values(entities)[0]!;
      const r = (await executeTool(c, "mutate", {
        songId: s.id,
        expectedRevision: c.current!.revision,
        operationId: `edit-${table}`,
        label: `Edit ${table}`,
        command: {
          kind: "edit",
          changes: [
            { table, id: entity.id, value: { ...entity, name: "Changed" } },
          ],
        },
      })) as { ok: boolean };
      expect(r.ok).toBe(true);
      expect(
        (
          (await executeTool(c, "read", { table, id: entity.id })) as {
            name: string;
          }
        ).name,
      ).toBe("Changed");
    }
    const changes = TABLES.flatMap((table) =>
      Object.keys(c.song!.tables[table]).map((id) => ({
        table,
        id,
        value: null,
      })),
    );
    const result = (await executeTool(c, "mutate", {
      songId: s.id,
      expectedRevision: c.current!.revision,
      operationId: "remove-all",
      label: "Remove all entities together",
      command: {
        kind: "edit",
        changes: [
          ...changes,
          { table: "meta", id: "arrangementOrder", value: [] },
        ],
      },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    for (const table of TABLES)
      expect(await executeTool(c, "read", { table })).toEqual({});
    const schema = (await executeTool(c, "schema")) as {
      templates: Record<string, unknown>;
    };
    expect(Object.keys(schema.templates).sort()).toEqual([...TABLES].sort());
  } finally {
    c.dispose();
  }
});
