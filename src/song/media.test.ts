import { it, expect } from "bun:test";
import { mediaSong } from "../../tests/media.ts";
import { takePlacements, takeSchedule } from "./media.ts";
import { validateSong } from "./validate.ts";
import { applyCommand } from "./commands.ts";
import { hydrateEnvelope } from "./history.ts";
const assetId = "1".repeat(64);
function fixture() {
  const s = mediaSong();
  s.tables.assets[assetId] = {
    id: assetId,
    name: "Audio",
    mime: "audio/wav",
    bytes: 100,
    duration: 6,
  };
  s.tables.takes.t = {
    id: "t",
    name: "Vocal",
    assetId,
    partId: "voice",
    sectionId: "a",
    start: [1, 3],
    offset: 1,
    duration: 4,
    gain: 0.5,
    muted: false,
  };
  return s;
}
it("takes repeat at exact musical starts with fixed-second trims and seek offsets", () => {
  const s = fixture();
  s.tables.arrangement.again = { id: "again", name: "Return", sectionId: "a" };
  s.arrangementOrder.push("again");
  expect(validateSong(s).ok).toBe(true);
  expect(takePlacements(s).map((t) => t.at)).toEqual([
    [1, 3],
    [25, 3],
  ]);
  const before = structuredClone(s.tables.takes);
  let r = takeSchedule(s, 1);
  expect(r[0]!.at).toBe(1);
  expect(r[0]!.offset).toBeCloseTo(1 + ((2 / 3) * 60) / 112);
  expect(r[0]!.gain).toBeCloseTo(0.4);
  s.tempo.bpm = 224;
  r = takeSchedule(s, 1);
  expect(r[0]!.offset).toBeCloseTo(1 + ((2 / 3) * 60) / 224);
  expect(s.tables.takes).toEqual(before);
  s.tables.takes.t!.muted = true;
  expect(takeSchedule(s, 0)).toEqual([]);
  s.tables.takes.t!.muted = false;
  s.tables.parts.voice!.muted = true;
  expect(takeSchedule(s, 0)).toEqual([]);
});
it("rejects incomplete references, invalid trims and local starts while allowing fixed-second tails", () => {
  const s = fixture();
  s.tables.takes.t!.start = [7, 1];
  expect(validateSong(s).ok).toBe(true);
  s.tables.takes.t!.start = [8, 1];
  expect(validateSong(s).ok).toBe(false);
  s.tables.takes.t!.sectionId = null;
  expect(validateSong(s).ok).toBe(true);
  s.tables.takes.t!.offset = 4;
  expect(validateSong(s).ok).toBe(false);
  s.tables.takes.t!.offset = 0;
  delete s.tables.assets[assetId];
  expect(validateSong(s).ok).toBe(false);
});
it("section variations copy takes while retaining binary identity and independent source music", () => {
  const s = fixture(),
    before = structuredClone(s.tables.events);
  let e = applyCommand(
    undefined,
    {
      songId: s.id,
      expectedRevision: 0,
      operationId: "create",
      label: "Create",
      command: { kind: "replace", song: s },
    },
    0,
  );
  e = applyCommand(
    e,
    {
      songId: s.id,
      expectedRevision: 1,
      operationId: "vary",
      label: "Variation",
      command: {
        kind: "structure",
        action: {
          type: "variation",
          appearanceId: "a",
          newId: "answer",
          name: "Answer",
        },
      },
    },
    0,
  );
  const copy = Object.values(e.song!.tables.takes).find((t) => t.id !== "t")!;
  expect(copy.sectionId).toBe("answer");
  expect(copy.assetId).toBe(assetId);
  expect(copy.start).toEqual([1, 3]);
  for (const [id, event] of Object.entries(before))
    expect(e.song!.tables.events[id]).toEqual(event);
  expect(Object.keys(e.song!.tables.assets)).toEqual([assetId]);
});
it("schema 5 documents and deleted snapshots migrate without changing receipt fingerprints", () => {
  const s = mediaSong();
  let e = applyCommand(
    undefined,
    {
      songId: s.id,
      expectedRevision: 0,
      operationId: "create",
      label: "Create",
      command: { kind: "replace", song: s },
    },
    0,
  );
  const legacy = structuredClone(e) as any;
  legacy.song.schemaVersion = 5;
  delete legacy.song.tables.assets;
  delete legacy.song.tables.takes;
  e = hydrateEnvelope(legacy);
  expect(e.song!.schemaVersion).toBe(7);
  expect(e.song!.tables.assets).toEqual({});
  expect(e.history[0]!.fingerprint).toBe(legacy.history[0].fingerprint);
  const deleted = applyCommand(
    e,
    {
      songId: e.id,
      expectedRevision: 1,
      operationId: "delete",
      label: "Delete",
      command: { kind: "delete" },
    },
    0,
  );
  expect(
    hydrateEnvelope(deleted).history.at(-1)!.deletedSong!.tables.takes,
  ).toEqual({});
});
