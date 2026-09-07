import "fake-indexeddb/auto";
import { it, expect } from "bun:test";
import { Controller } from "../app/controller.ts";
import { openDb } from "../storage/projects.ts";
import { executeTool } from "./tools.ts";
import { emptySong, TABLES, type Song } from "../song/model.ts";
import { arrangementSong } from "../../tests/arrangement.ts";
import type { Envelope } from "../song/commands.ts";
it("exposes complete entity CRUD through the same command model, including chords and markers", async () => {
  const c = new Controller(await openDb(crypto.randomUUID()));
  try {
    await c.init();
    const s = arrangementSong("parity");
    const assetId = "0".repeat(64);
    s.tables.assets[assetId] = {
      id: assetId,
      name: "Fixture audio metadata",
      mime: "audio/wav",
      bytes: 44,
      duration: 1,
    };
    s.tables.takes.take = {
      id: "take",
      name: "Take",
      assetId,
      partId: "guitar",
      sectionId: null,
      start: [0, 1],
      offset: 0,
      duration: 1,
      gain: 1,
      muted: false,
    };
    s.tables.fretted.g = {
      id: "g",
      name: "Guitar",
      partId: "guitar",
      tonic: 48,
      tuning: [64, 59, 55, 50, 45, 40],
      capo: 0,
      maxFret: 24,
      handSpan: 4,
    };
    s.tables.fingerings.f = {
      id: "f",
      name: "Root",
      arrangementId: "g",
      occurrenceId: "guitar",
      eventId: "chord",
      memberId: "root",
      string: 5,
      fret: 3,
      technique: "pluck",
      fromId: null,
    };
    s.tables.harmony.h = {
      id: "h",
      name: "Context",
      sectionId: null,
      start: [0, 1],
      duration: [4, 1],
      tonic: { degree: 1, alteration: 0, octave: 0 },
      mode: "major",
      annotation: "",
    };
    s.tables.polyrhythms.poly = {
      id: "poly",
      name: "Grid",
      sectionId: "verse",
      start: [0, 1],
      duration: [4, 1],
      lanes: [
        { occurrenceId: "guitar", divisions: 3 },
        { occurrenceId: "drums", divisions: 2 },
      ],
    };
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

it("shares structural previews, mutations, navigation and redo with agents, and rejects stale previews", async () => {
  const c = new Controller(await openDb(crypto.randomUUID()));
  try {
    await c.import(JSON.stringify(arrangementSong("structure-parity")), false);
    const command = {
      kind: "structure",
      action: { type: "repeat", appearanceId: "verse", newId: "repeat" },
    };
    const preview = (await executeTool(c, "preview", { command })) as {
      revision: number;
      sections: unknown[];
    };
    expect(preview.sections).toHaveLength(3);
    expect(c.song!.arrangementOrder).toHaveLength(2);
    await c.edit(
      {
        kind: "edit",
        changes: [{ table: "meta", id: "title", value: "Writer edit" }],
      },
      "Writer edit",
    );
    const stale = (await executeTool(c, "mutate", {
      songId: c.song!.id,
      expectedRevision: preview.revision,
      operationId: "stale-preview",
      label: "Repeat",
      command,
    })) as { ok: boolean };
    expect(stale.ok).toBe(false);
    const mutation = {
      songId: c.song!.id,
      expectedRevision: c.current!.revision,
      operationId: "repeat-once",
      label: "Repeat",
      command,
    };
    expect(
      ((await executeTool(c, "mutate", mutation)) as { ok: boolean }).ok,
    ).toBe(true);
    expect(
      ((await executeTool(c, "mutate", mutation)) as { ok: boolean }).ok,
    ).toBe(true);
    expect(c.song!.arrangementOrder).toHaveLength(3);
    const revision = c.current!.revision;
    await executeTool(c, "navigate", { appearanceId: "turn", zoom: 64 });
    expect(c.jumpTo).toBe(32);
    expect(c.current!.revision).toBe(revision);
    await c.historyAction("undo");
    expect(c.song!.arrangementOrder).toHaveLength(2);
    await c.historyAction("redo");
    expect(c.song!.arrangementOrder).toHaveLength(3);
    const range = (await executeTool(c, "read", {
      from: [16, 1],
      until: [32, 1],
    })) as { annotations: unknown[] };
    expect(range.annotations).toHaveLength(2);
    expect(JSON.parse(c.export()).tables.lyrics.words.text).toContain(
      "between us",
    );
  } finally {
    c.dispose();
  }
});

it("serializes local field intentions but never rebases them over a foreign mutation", async () => {
  const c = new Controller(await openDb(crypto.randomUUID()));
  try {
    await c.import(JSON.stringify(arrangementSong("field-intentions")), false);
    const a = c.patchEntity(
      "occurrences",
      "guitar",
      { span: [31, 2] },
      "Shorten span",
    );
    const b = c.patchEntity(
      "occurrences",
      "guitar",
      { start: [1, 2] },
      "Delay entrance",
    );
    expect((await a).ok).toBe(true);
    expect((await b).ok).toBe(true);
    expect(c.song!.tables.occurrences.guitar!.span).toEqual([31, 2]);
    expect(c.song!.tables.occurrences.guitar!.start).toEqual([1, 2]);
    const other = executeTool(c, "mutate", {
      songId: c.song!.id,
      expectedRevision: c.current!.revision,
      operationId: "foreign-edit",
      label: "Agent title",
      command: {
        kind: "edit",
        changes: [{ table: "meta", id: "title", value: "Agent title" }],
      },
    });
    const local = c.patchTitle("Stale writer title");
    expect(((await other) as { ok: boolean }).ok).toBe(true);
    expect((await local).ok).toBe(false);
    expect(c.song!.title).toBe("Agent title");
    expect(c.pending).toBe(0);
  } finally {
    c.dispose();
  }
});

it("shares rhythm previews, queries, durable retries and undo through tools", async () => {
  const c = new Controller(await openDb(crypto.randomUUID()));
  try {
    await c.import(JSON.stringify(arrangementSong("rhythm-parity")), false);
    const command = {
      kind: "rhythm",
      action: {
        type: "polyrhythm",
        newId: "poly",
        name: "Three against two",
        sectionId: "verse",
        start: [0, 1],
        duration: [4, 1],
        noteDuration: [1, 4],
        lanes: [
          {
            voiceId: "high",
            divisions: 3,
            pitch: { degree: 1, alteration: 0, octave: 0 },
            drum: "kick",
          },
          {
            voiceId: "drums",
            divisions: 2,
            pitch: { degree: 5, alteration: 0, octave: 0 },
            drum: "hat",
          },
        ],
      },
    };
    const preview = (await executeTool(c, "preview", { command })) as any;
    expect(c.song!.tables.polyrhythms).toEqual({});
    await c.patchTitle("Intervening writer");
    const m = {
      songId: c.song!.id,
      expectedRevision: preview.revision,
      operationId: "rhythm-retry",
      label: "Build pulse",
      command,
    };
    expect(((await executeTool(c, "mutate", m)) as any).ok).toBe(false);
    m.expectedRevision = c.current!.revision;
    expect(((await executeTool(c, "mutate", m)) as any).ok).toBe(true);
    const revision = c.current!.revision;
    expect(((await executeTool(c, "mutate", m)) as any).ok).toBe(true);
    expect(c.current!.revision).toBe(revision);
    expect(
      (
        (await executeTool(c, "polyrhythm_grid", { id: "poly" })) as any
      )[0].lanes.every((l: any) => l.matches),
    ).toBe(true);
    expect(
      (
        (await executeTool(c, "alignments", {
          occurrenceIds: ["poly-o0", "poly-o1"],
          from: [0, 1],
          until: [4, 1],
        })) as any
      ).common,
    ).toEqual([[0, 1]]);
    expect(
      (
        (await executeTool(c, "compare_patterns", {
          sourceId: "poly-p0",
          variationId: "poly-p1",
        })) as any
      ).rows,
    ).toHaveLength(5);
    await c.historyAction("undo");
    expect(c.song!.tables.polyrhythms).toEqual({});
    await c.historyAction("redo");
    expect(JSON.parse(c.export()).tables.polyrhythms.poly.lanes).toHaveLength(
      2,
    );
    expect(c.song!.title).toBe("Intervening writer");
  } finally {
    c.dispose();
  }
});

it("harmony commands and context queries share previews, retries, conflicts and undo", async () => {
  const { harmonySong, recipe } = await import("../../tests/harmony.ts");
  const c = new Controller(await openDb(crypto.randomUUID()));
  try {
    await c.import(JSON.stringify(harmonySong("harmony-tools")), false);
    const command = {
      kind: "harmony",
      action: {
        type: "build",
        newId: "new-chord",
        name: "Applied",
        recipe: recipe({ root: "V", target: "V", extension: 7 }),
        eventId: "chord",
        performance: "reset",
      },
    };
    const p = (await executeTool(c, "preview", { command })) as any;
    expect(p.affectedPlacements.map((o: any) => o.id)).toContain("guitar");
    await c.patchTitle("Writer title");
    const m = {
      songId: c.song!.id,
      expectedRevision: p.revision,
      operationId: "harmony-build",
      label: "Build",
      command,
    };
    expect(((await executeTool(c, "mutate", m)) as any).ok).toBe(false);
    m.expectedRevision = c.current!.revision;
    expect(((await executeTool(c, "mutate", m)) as any).ok).toBe(true);
    const revision = c.current!.revision;
    expect(((await executeTool(c, "mutate", m)) as any).ok).toBe(true);
    expect(c.current!.revision).toBe(revision);
    expect(
      ((await executeTool(c, "harmonic_context", { at: [4, 1] })) as any).tonic
        .degree,
    ).toBe(5);
    expect(
      (
        (await executeTool(c, "chord_candidates", {
          chordId: "new-chord",
        })) as any
      ).candidates.length,
    ).toBeGreaterThan(0);
    expect(
      (
        (await executeTool(c, "sounding_harmony", { at: [0, 1] })) as any
      ).voices.some((v: any) => v.id === "bass"),
    ).toBe(true);
    expect(
      (
        (await executeTool(c, "voice_leading", {
          sourceId: "tonic",
          targetId: "new-chord",
          octaveRadius: 1,
        })) as any
      ).moves,
    ).toHaveLength(4);
    await c.historyAction("undo");
    expect(c.song!.tables.chords["new-chord"]).toBeUndefined();
    await c.historyAction("redo");
    expect(JSON.parse(c.export()).tables.chords["new-chord"].label).toBe(
      "V7/V",
    );
  } finally {
    c.dispose();
  }
});

it("fretted queries share exact position diagnostics, durable retries and undo with UI edits", async () => {
  const { frettedSong, finger } = await import("../../tests/fretted.ts");
  const c = new Controller(await openDb(crypto.randomUUID()));
  try {
    await c.init();
    const s = frettedSong();
    await c.import(JSON.stringify(s), false, "fretted-import");
    const args = {
      arrangementId: "drop",
      occurrenceId: "line",
      eventId: "first",
      memberId: null,
    };
    const choices = (await executeTool(c, "fret_positions", args)) as any;
    expect(choices.positions).toContainEqual({
      string: 2,
      fret: 3,
      physicalFret: 3,
    });
    const command = {
      kind: "edit",
      changes: [{ table: "fingerings", id: "f", value: finger("f") }],
    };
    const preview = (await executeTool(c, "preview", { command })) as any;
    const mutation = {
      songId: s.id,
      expectedRevision: preview.revision,
      operationId: "assign",
      label: "Assign",
      command,
    };
    expect(((await executeTool(c, "mutate", mutation)) as any).ok).toBe(true);
    const revision = c.current!.revision;
    expect(((await executeTool(c, "mutate", mutation)) as any).ok).toBe(true);
    expect(c.current!.revision).toBe(revision);
    const result = (await executeTool(c, "tablature", {
      arrangementId: "drop",
      from: [0, 1],
      until: [8, 1],
    })) as any;
    expect(
      result.rows
        .filter((n: any) => n.fingering)
        .every((n: any) => n.issues.length === 0),
    ).toBe(true);
    expect((await c.historyAction("undo")).ok).toBe(true);
    expect(c.song!.tables.fingerings).toEqual({});
    expect((await c.historyAction("redo")).ok).toBe(true);
    expect(c.song!.tables.fingerings.f!.fret).toBe(3);
  } finally {
    c.dispose();
  }
});
