import { it, expect } from "bun:test";
import { arrangementSong } from "../../tests/arrangement.ts";
import {
  applyCommand,
  previewCommand,
  type Command,
  type Envelope,
} from "./commands.ts";
import { sectionSpans, placements, annotations } from "./arrangement.ts";
import { sounds, alignment } from "./timeline.ts";
import { validateSong } from "./validate.ts";
import { historyStacks, hydrateEnvelope } from "./history.ts";
const create = () =>
  applyCommand(
    undefined,
    {
      songId: "arranged",
      expectedRevision: 0,
      operationId: "create",
      label: "Create",
      command: { kind: "replace", song: arrangementSong() },
    },
    1,
  );
const edit = (
  e: Envelope,
  command: Command,
  operationId = `edit-${e.revision}`,
) =>
  applyCommand(
    e,
    {
      songId: e.id,
      expectedRevision: e.revision,
      operationId,
      label: "Edit",
      command,
    },
    e.revision + 1,
  );
it("repeats actual section music and annotations, moves them exactly, and leaves global bass fixed", () => {
  const first = create();
  const repeated = edit(first, {
    kind: "structure",
    action: { type: "repeat", appearanceId: "verse", newId: "again" },
  });
  const moved = edit(repeated, {
    kind: "structure",
    action: { type: "move", appearanceId: "again", direction: 1 },
  });
  expect(moved.song!.arrangementOrder).toEqual(["verse", "turn", "again"]);
  expect(sectionSpans(moved.song!).map((a) => a.start)).toEqual([
    [0, 1],
    [16, 1],
    [32, 1],
  ]);
  expect(
    placements(moved.song!)
      .filter((o) => o.id === "guitar")
      .map((o) => o.start),
  ).toEqual([
    [0, 1],
    [32, 1],
  ]);
  expect(
    annotations(moved.song!)
      .filter((a) => a.table === "lyrics")
      .map((a) => a.start),
  ).toEqual([
    [1, 2],
    [65, 2],
  ]);
  expect(sounds(moved.song!).filter((n) => n.partId === "bass")).toEqual(
    sounds(first.song!).filter((n) => n.partId === "bass"),
  );
  expect(alignment(moved.song!, ["guitar", "drums"], [16, 1], [48, 1])).toEqual(
    [32, 1],
  );
  const soundIds = sounds(moved.song!).map((n) => n.id);
  expect(new Set(soundIds).size).toBe(soundIds.length);
});
it("copies a section with its music and lyrics while preserving internal chord sharing and the source", () => {
  let e = create();
  e = edit(e, {
    kind: "structure",
    action: { type: "repeat", appearanceId: "verse", newId: "again" },
  });
  const source = structuredClone(e.song!);
  e = edit(e, {
    kind: "structure",
    action: {
      type: "variation",
      appearanceId: "again",
      newId: "var",
      name: "A′",
    },
  });
  const t = e.song!.tables;
  expect(t.arrangement.verse!.sectionId).toBe("verse");
  expect(t.arrangement.again!.sectionId).toBe("var");
  expect(t.sections.var!.sourceId).toBe("verse");
  const occurrence = Object.values(t.occurrences).find(
    (o) => o.sectionId === "var" && o.voiceId === "guitar",
  )!;
  expect(occurrence.patternId).not.toBe("seven");
  const chordEvent = Object.values(t.events).find(
    (n) => n.patternId === occurrence.patternId && n.kind === "chord",
  )!;
  expect(chordEvent.chordId).not.toBe("tonic");
  expect(chordEvent.performance).toEqual(t.events.chord!.performance);
  const lyric = Object.values(t.lyrics).find((l) => l.sectionId === "var")!;
  expect(t.phrases[lyric.phraseId!]!.sectionId).toBe("var");
  e = edit(e, {
    kind: "edit",
    changes: [
      {
        table: "lyrics",
        id: lyric.id,
        value: { ...lyric, text: "Return in another shape" },
      },
      {
        table: "occurrences",
        id: occurrence.id,
        value: { ...occurrence, start: [1, 2], span: [31, 2] },
      },
    ],
  });
  for (const [table, entries] of Object.entries(source.tables))
    for (const [id, original] of Object.entries(entries)) {
      if (table === "arrangement" && id === "again") continue;
      expect((e.song!.tables as any)[table][id]).toEqual(original);
    }
});
it("previews without mutation and rejects overflow, missing references, and cyclic lineage", () => {
  const e = create();
  const preview = previewCommand(e, {
    kind: "structure",
    action: { type: "remove", appearanceId: "verse" },
  });
  expect(preview.sections.map((a) => a.start)).toEqual([[0, 1]]);
  expect(e.song!.arrangementOrder).toEqual(["verse", "turn"]);
  expect(preview.fixedGlobalPlacements.map((o) => o.id)).toEqual(["bass"]);
  expect(() =>
    edit(e, {
      kind: "edit",
      changes: [
        {
          table: "bars",
          id: "bar-0",
          value: {
            ...e.song!.tables.bars["bar-0"],
            numerator: 3,
            groups: [1, 1, 1],
          },
        },
      ],
    }),
  ).toThrow("exceeds its section");
  expect(() =>
    edit(e, {
      kind: "edit",
      changes: [{ table: "phrases", id: "question", value: null }],
    }),
  ).toThrow("Broken phrases");
  expect(() =>
    edit(e, {
      kind: "edit",
      changes: [
        {
          table: "lyrics",
          id: "words",
          value: { ...e.song!.tables.lyrics.words, start: [7, 1] },
        },
      ],
    }),
  ).toThrow("contain its lyric");
  const broken = structuredClone(e.song!);
  broken.tables.sections.verse!.sourceId = "turn";
  broken.tables.sections.turn!.sourceId = "verse";
  expect(validateSong(broken).ok).toBe(false);
});
it("meter growth moves following section music without stretching local music or global bass", () => {
  let e = create();
  e = edit(e, {
    kind: "structure",
    action: { type: "repeat", appearanceId: "verse", newId: "again" },
  });
  const before = e.song!;
  e = edit(e, {
    kind: "edit",
    changes: [
      {
        table: "bars",
        id: "bar-0",
        value: { ...before.tables.bars["bar-0"], numerator: 5, groups: [2, 3] },
      },
    ],
  });
  expect(sectionSpans(e.song!).map((a) => a.start)).toEqual([
    [0, 1],
    [17, 1],
    [34, 1],
  ]);
  expect(e.song!.tables.events).toEqual(before.tables.events);
  expect(e.song!.tables.occurrences).toEqual(before.tables.occurrences);
});
it("attaches a fitting global placement explicitly and rejects a crossing one", () => {
  let e = create();
  const o = {
    ...e.song!.tables.occurrences.guitar!,
    sectionId: null,
    start: [16, 1] as const,
    span: [8, 1] as const,
  };
  e = edit(e, {
    kind: "edit",
    changes: [{ table: "occurrences", id: o.id, value: o }],
  });
  e = edit(e, {
    kind: "structure",
    action: { type: "attach", appearanceId: "turn", occurrenceId: o.id },
  });
  expect(e.song!.tables.occurrences.guitar!.start).toEqual([0, 1]);
  expect(e.song!.tables.occurrences.guitar!.sectionId).toBe("turn");
  expect(() =>
    edit(e, {
      kind: "structure",
      action: { type: "attach", appearanceId: "verse", occurrenceId: "bass" },
    }),
  ).toThrow("exceeds its section");
});
it("undo and redo restore an arrangement atomically and preserve unrelated edits", () => {
  let e = edit(
    create(),
    {
      kind: "structure",
      action: { type: "repeat", appearanceId: "verse", newId: "again" },
    },
    "repeat",
  );
  e = edit(
    e,
    {
      kind: "edit",
      changes: [{ table: "meta", id: "title", value: "Writer title" }],
    },
    "title",
  );
  e = edit(e, { kind: "undo", targetId: "repeat" }, "undo-repeat");
  expect(e.song!.arrangementOrder).toEqual(["verse", "turn"]);
  expect(e.song!.title).toBe("Writer title");
  expect(historyStacks(e.history).redo).toEqual(["undo-repeat"]);
  e = edit(e, { kind: "undo", targetId: "undo-repeat" }, "redo-repeat");
  expect(e.song!.arrangementOrder).toEqual(["verse", "again", "turn"]);
  expect(historyStacks(e.history).undo.at(-1)).toBe("redo-repeat");
  expect(historyStacks(e.history).redo).toEqual([]);
});
it("migrates legacy song and history without changing timing or retry fingerprints", () => {
  const legacy: any = create();
  legacy.song.schemaVersion = 1;
  delete legacy.song.tables.phrases;
  delete legacy.song.tables.lyrics;
  for (const s of Object.values(legacy.song.tables.sections) as any[])
    delete s.sourceId;
  for (const o of Object.values(legacy.song.tables.occurrences) as any[])
    delete o.sectionId;
  legacy.history[0].deltas = legacy.history[0].deltas.filter(
    (d: any) => !["phrases", "lyrics"].includes(d.table),
  );
  for (const d of legacy.history[0].deltas)
    if (d.after && typeof d.after === "object") {
      if (d.table === "sections") delete d.after.sourceId;
      if (d.table === "occurrences") delete d.after.sectionId;
    }
  const e = hydrateEnvelope(legacy);
  expect(e.revision).toBe(legacy.revision);
  expect(e.history[0]!.fingerprint).toBe(legacy.history[0].fingerprint);
  expect(e.song!.schemaVersion).toBe(5);
  expect(e.song!.tables.occurrences.guitar!.sectionId).toBe(null);
  expect(e.song!.tables.occurrences.guitar!.start).toEqual(
    legacy.song.tables.occurrences.guitar.start,
  );
  expect(e.song!.tables.events).toEqual(legacy.song.tables.events);
  expect(edit(e, { kind: "undo", targetId: "create" }).song).toBe(null);
  expect(validateSong({ ...e.song, schemaVersion: 99 }).ok).toBe(false);
});
it("section placements preserve independent releases past an appearance unless cut is explicit", () => {
  const s = arrangementSong();
  delete s.tables.events.rest;
  s.tables.events.chord!.duration = [20, 1];
  const first = sounds(s).find(
    (n) => n.eventId === "chord" && n.start[0] === 0 && n.pitch?.degree === 1,
  )!;
  expect(first.duration).toEqual([20, 1]);
  s.tables.occurrences.guitar!.tails = "cut";
  const cut = sounds(s).find(
    (n) => n.eventId === "chord" && n.start[0] === 0 && n.pitch?.degree === 1,
  )!;
  expect(cut.duration).toEqual([16, 1]);
  const third = sounds(s).find(
    (n) => n.eventId === "chord" && n.start[0] === 1 && n.start[1] === 2,
  )!;
  expect(third.duration).toEqual([1, 1]);
});
