import "fake-indexeddb/auto";
import { it, expect } from "bun:test";
import { openDb, save, read } from "../storage/projects.ts";
import {
  MediaLibrary,
  base64,
  digest,
  unbase64,
  type StoredAudio,
} from "./library.ts";
import { wav, mediaSong } from "../../tests/media.ts";
import { Controller } from "../app/controller.ts";
const decode = async (bytes: ArrayBuffer) => {
  const v = new DataView(bytes);
  if (v.getUint32(0) !== 0x52494646) throw new Error("Invalid test WAV");
  return v.getUint32(40, true) / v.getUint32(28, true);
};
it("encoded audio deduplicates by bytes, survives reopening, and detects corruption on export", async () => {
  const name = crypto.randomUUID();
  let db = await openDb(name),
    lib = new MediaLibrary(db, decode);
  const bytes = wav();
  const a = await lib.import(new Blob([bytes], { type: "audio/wav" }), "A");
  expect(a.id).toBe(await digest(bytes));
  expect(
    (await lib.import(new Blob([bytes], { type: "audio/wav" }), "B")).id,
  ).toBe(a.id);
  expect(await lib.entries()).toHaveLength(1);
  db.close();
  db = await openDb(name);
  lib = new MediaLibrary(db, decode);
  expect(base64(await (await lib.get(a.id)).blob.arrayBuffer())).toBe(
    base64(bytes),
  );
  await save(db, "media", {
    id: a.id,
    asset: a,
    blob: new Blob([wav(1, 330)], { type: "audio/wav" }),
  });
  await expect(lib.get(a.id)).rejects.toThrow("Corrupt");
  db.close();
});
it("complete bundles round trip bytes and reject missing, extra, duplicate and altered audio before song edits", async () => {
  const db = await openDb(crypto.randomUUID()),
    other = await openDb(crypto.randomUUID());
  try {
    const lib = new MediaLibrary(db, decode),
      dest = new MediaLibrary(other, decode),
      a = await lib.import(new Blob([wav()], { type: "audio/wav" }), "Tone"),
      s = mediaSong();
    s.tables.assets[a.id] = a;
    const bundle = await lib.exportBundle(s),
      restored = await dest.stageBundle(bundle);
    expect(restored).toEqual(s);
    expect(base64(await (await dest.get(a.id)).blob.arrayBuffer())).toBe(
      base64(wav()),
    );
    const parsed = JSON.parse(bundle);
    parsed.assets = [];
    await expect(dest.stageBundle(JSON.stringify(parsed))).rejects.toThrow(
      "every referenced",
    );
    parsed.assets = JSON.parse(bundle).assets;
    parsed.assets.push(parsed.assets[0]);
    await expect(dest.stageBundle(JSON.stringify(parsed))).rejects.toThrow();
    parsed.assets = [
      { ...JSON.parse(bundle).assets[0], base64: base64(wav(1, 330)) },
    ];
    await expect(dest.stageBundle(JSON.stringify(parsed))).rejects.toThrow(
      "metadata mismatch",
    );
    const missing = new MediaLibrary(await openDb(crypto.randomUUID()), decode);
    await expect(missing.exportBundle(s)).rejects.toThrow("Missing");
    missing.db.close();
  } finally {
    db.close();
    other.close();
  }
});
it("failed attachments retain staged media, receipt retry deduplicates, and history protects audio after undo/deletion", async () => {
  const db = await openDb(crypto.randomUUID()),
    c = new Controller(db);
  try {
    const lib = new MediaLibrary(db, decode),
      a = await lib.import(new Blob([wav()], { type: "audio/wav" }), "Take");
    await c.init();
    await c.import(JSON.stringify(mediaSong()), false, "init");
    const take = {
      id: "take",
      name: "Idea",
      assetId: a.id,
      partId: "voice",
      sectionId: null,
      start: [0, 1] as [number, number],
      offset: 0,
      duration: a.duration,
      gain: 1,
      muted: false,
    };
    expect((await c.media.attach(a.id, take, 0, "stale")).ok).toBe(false);
    expect((await lib.get(a.id)).asset).toEqual(a);
    expect(c.song!.tables.takes).toEqual({});
    const revision = c.current!.revision;
    expect((await c.media.attach(a.id, take, revision, "attach")).ok).toBe(
      true,
    );
    expect((await c.media.attach(a.id, take, revision, "attach")).ok).toBe(
      true,
    );
    expect(Object.keys(c.song!.tables.takes)).toEqual(["take"]);
    await c.historyAction("undo");
    expect(c.song!.tables.takes).toEqual({});
    await expect(lib.removeUnused(a.id)).rejects.toThrow("protected");
    await c.historyAction("redo");
    await c.edit({ kind: "delete" }, "Delete song");
    await expect(lib.removeUnused(a.id)).rejects.toThrow("protected");
    expect((await lib.get(a.id)).blob.size).toBe(wav().byteLength);
    const unused = await lib.import(
      new Blob([wav(0.5)], { type: "audio/wav" }),
      "Unused",
    );
    await lib.removeUnused(unused.id);
    await expect(lib.get(unused.id)).rejects.toThrow("Missing");
  } finally {
    c.dispose();
  }
});
it("validates encoded data and respects capture references during unused cleanup", async () => {
  expect(() => unbase64("*bad*")).toThrow();
  const db = await openDb(crypto.randomUUID()),
    lib = new MediaLibrary(db, decode);
  try {
    await expect(
      lib.import(new Blob([wav()], { type: "text/plain" }), "Invalid MIME"),
    ).rejects.toThrow();
    const a = await lib.import(
      new Blob([wav()], { type: "audio/wav" }),
      "Capture",
    );
    await save(db, "captures", { id: "capture", assetId: a.id });
    await expect(lib.removeUnused(a.id)).rejects.toThrow("capture");
  } finally {
    db.close();
  }
});
it("upgrades an existing database without replacing songs/settings/sessions", async () => {
  const name = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      for (const n of ["songs", "settings", "sessions"])
        r.result.createObjectStore(n, { keyPath: "id" });
    };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result,
        tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put({ id: "old", value: 42 });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
  const db = await openDb(name);
  expect(db.version).toBe(2);
  expect(
    await read<{ id: string; value: number }>(db, "settings", "old"),
  ).toEqual({ id: "old", value: 42 });
  expect(db.objectStoreNames.contains("captures")).toBe(true);
  db.close();
});
