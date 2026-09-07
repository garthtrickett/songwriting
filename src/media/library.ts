import { read, list } from "../storage/projects.ts";
import type { AudioAsset, Song } from "../song/model.ts";
import type { Envelope } from "../song/commands.ts";
import { MAX_ASSET_BYTES, MAX_BUNDLE_BYTES } from "../song/media.ts";
import { validateSong } from "../song/validate.ts";
export interface StoredAudio {
  id: string;
  asset: AudioAsset;
  blob: Blob;
}
export const digest = async (bytes: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
export const base64 = (bytes: ArrayBuffer) => {
  const a = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < a.length; i += 16384)
    s += String.fromCharCode(...a.subarray(i, i + 16384));
  return btoa(s);
};
export function unbase64(text: string, limit = MAX_ASSET_BYTES) {
  if (
    typeof text !== "string" ||
    text.length > Math.ceil(limit / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      text,
    )
  )
    throw new Error("Invalid or oversized base64 audio");
  const s = atob(text),
    bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
  if (!bytes.length || bytes.length > limit)
    throw new Error("Empty or oversized audio");
  return bytes.buffer;
}
async function decodeDuration(bytes: ArrayBuffer) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return (await ctx.decodeAudioData(bytes.slice(0))).duration;
}
export class MediaLibrary {
  constructor(
    readonly db: IDBDatabase,
    readonly decode: (bytes: ArrayBuffer) => Promise<number> = decodeDuration,
  ) {}
  async prepare(blob: Blob, name: string): Promise<StoredAudio> {
    if (
      !blob.size ||
      blob.size > MAX_ASSET_BYTES ||
      !/^audio\//.test(blob.type) ||
      typeof name !== "string" ||
      name.length > 10000
    )
      throw new Error("Choose an audio file up to 25 MiB");
    const bytes = await blob.arrayBuffer(),
      duration = await this.decode(bytes);
    if (!Number.isFinite(duration) || duration < 0.001 || duration > 600)
      throw new Error("Decoded audio must be between 1 ms and 10 minutes");
    const id = await digest(bytes);
    return {
      id,
      asset: { id, name, mime: blob.type, bytes: blob.size, duration },
      blob,
    };
  }
  async store(item: StoredAudio): Promise<AudioAsset> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("media", "readwrite"),
        store = tx.objectStore("media"),
        get = store.get(item.id);
      let result = item.asset;
      let failure: unknown;
      get.onsuccess = () => {
        const old = get.result as StoredAudio | undefined;
        if (old) {
          if (
            old.asset.bytes !== item.asset.bytes ||
            Math.abs(old.asset.duration - item.asset.duration) > 0.005
          ) {
            failure = new Error(
              "Existing media identity conflicts with metadata",
            );
            tx.abort();
          } else result = old.asset;
        } else store.put(item);
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error("Audio save aborted"));
    });
  }
  async import(blob: Blob, name: string) {
    return this.store(await this.prepare(blob, name));
  }
  async entries() {
    return (await list<StoredAudio>(this.db, "media")).map((i) => i.asset);
  }
  async get(id: string) {
    const r = await read<StoredAudio>(this.db, "media", id);
    if (!r) throw new Error(`Missing audio asset ${id}`);
    const bytes = await r.blob.arrayBuffer();
    if (
      r.asset.id !== id ||
      bytes.byteLength !== r.asset.bytes ||
      (await digest(bytes)) !== id
    )
      throw new Error(`Corrupt audio asset ${id}`);
    return r;
  }
  async exportBundle(s: Song) {
    const assets = [];
    let total = 0;
    for (const a of Object.values(s.tables.assets)) {
      total += a.bytes;
      if (total > MAX_BUNDLE_BYTES)
        throw new Error("Bundle audio exceeds 50 MiB");
      const item = await this.get(a.id);
      this.match(a, item.asset);
      assets.push({ id: a.id, base64: base64(await item.blob.arrayBuffer()) });
    }
    return JSON.stringify({ bundleVersion: 1, song: s, assets });
  }
  private match(a: AudioAsset, b: AudioAsset) {
    if (
      a.id !== b.id ||
      a.bytes !== b.bytes ||
      a.mime !== b.mime ||
      Math.abs(a.duration - b.duration) > 0.005
    )
      throw new Error(`Audio metadata mismatch for ${a.id}`);
  }
  async stageBundle(text: string): Promise<Song> {
    if (
      typeof text !== "string" ||
      text.length > MAX_BUNDLE_BYTES * 1.5 + 5 * 1024 * 1024
    )
      throw new Error("Bundle too large");
    const parsed = JSON.parse(text);
    if (parsed.bundleVersion !== 1 || !Array.isArray(parsed.assets))
      throw new Error("Unsupported media bundle");
    const valid = validateSong(parsed.song);
    if (!valid.ok) throw new Error(valid.error);
    const s = valid.value,
      expected = Object.values(s.tables.assets);
    if (parsed.assets.length !== expected.length)
      throw new Error(
        "Bundle must contain every referenced asset exactly once",
      );
    let total = 0;
    const seen = new Set<string>(),
      prepared: StoredAudio[] = [];
    for (const entry of parsed.assets) {
      if (
        !entry ||
        !Object.hasOwn(s.tables.assets, entry.id) ||
        seen.has(entry.id)
      )
        throw new Error("Duplicate or unexpected bundle asset");
      seen.add(entry.id);
      const meta = s.tables.assets[entry.id]!;
      total += meta.bytes;
      if (total > MAX_BUNDLE_BYTES)
        throw new Error("Bundle audio exceeds 50 MiB");
      const bytes = unbase64(entry.base64);
      if (bytes.byteLength !== meta.bytes)
        throw new Error("Bundle byte count mismatch");
      const item = await this.prepare(
        new Blob([bytes], { type: meta.mime }),
        meta.name,
      );
      this.match(meta, item.asset);
      prepared.push(item);
    }
    for (const item of prepared) await this.store(item);
    return s;
  }
  async removeUnused(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
          ["media", "songs", "captures"],
          "readwrite",
        ),
        songs = tx.objectStore("songs").getAll(),
        captures = tx.objectStore("captures").getAll();
      let pending = 2,
        failure: unknown;
      const inspect = () => {
        if (--pending) return;
        try {
          const used = (songs.result as Envelope[]).some(
            (e) =>
              Object.hasOwn(e.song?.tables.assets ?? {}, id) ||
              e.history.some(
                (h) =>
                  Object.hasOwn(h.deletedSong?.tables.assets ?? {}, id) ||
                  h.deltas.some(
                    (d) =>
                      (d.table === "assets" && d.id === id) ||
                      (d.table === "takes" &&
                        [d.before, d.after].some(
                          (v) =>
                            (v as { assetId?: string } | null)?.assetId === id,
                        )),
                  ),
              ),
          );
          if (
            used ||
            (captures.result as { assetId?: string }[]).some(
              (c) => c.assetId === id,
            )
          )
            throw new Error(
              "Audio is protected by a song, history or capture; retained for recovery",
            );
          tx.objectStore("media").delete(id);
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };
      songs.onsuccess = inspect;
      captures.onsuccess = inspect;
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure ?? tx.error);
    });
  }
}
