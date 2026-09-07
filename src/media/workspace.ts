import { cmp, time } from "../song/time.ts";
import { sectionLength } from "../song/arrangement.ts";
import type { Controller } from "../app/controller.ts";
import { MediaLibrary, base64, unbase64 } from "./library.ts";
import { Recorder, type CaptureIntent } from "./recorder.ts";
import type { Take, AudioAsset } from "../song/model.ts";
import { list } from "../storage/projects.ts";
export class MediaWorkspace {
  readonly library: MediaLibrary;
  readonly recorder: Recorder;
  constructor(readonly c: Controller) {
    this.library = new MediaLibrary(c.db);
    this.recorder = new Recorder(c.db, this.library, () => c.notify());
  }
  async status() {
    const assets = await this.library.entries(),
      ids = new Set(assets.map((a) => a.id));
    return {
      recording: {
        status: this.recorder.status,
        error: this.recorder.error,
        captureId: this.recorder.captureId,
        activeTracks: this.recorder.activeTracks,
      },
      assets,
      captures: await this.recorder.captures(),
      missing: Object.keys(this.c.song?.tables.assets ?? {}).filter(
        (id) => !ids.has(id),
      ),
    };
  }
  async importAudio(name: string, mime: string, encoded: string) {
    const a = await this.library.import(
      new Blob([unbase64(encoded)], { type: mime }),
      name,
    );
    this.c.notify();
    return a;
  }
  async attach(
    assetId: string,
    take: Take,
    expectedRevision: number,
    operationId: string,
  ) {
    const song = this.c.song;
    if (!song) throw new Error("Open a song");
    const stored = await this.library.get(assetId);
    if (take.assetId !== assetId)
      throw new Error("Take asset does not match selected media");
    if (
      Object.hasOwn(song.tables.takes, take.id) &&
      !this.c.current!.history.some((h) => h.operationId === operationId)
    )
      throw new Error(
        "Choose a new take ID; edit existing takes through mutate",
      );
    const meta = song.tables.assets[assetId] ?? stored.asset;
    return this.c.mutate({
      songId: song.id,
      expectedRevision,
      operationId,
      label: `Attach ${take.name}`,
      command: {
        kind: "edit",
        changes: [
          { table: "assets", id: assetId, value: meta },
          { table: "takes", id: take.id, value: take },
        ],
      },
    });
  }
  start(intent: Omit<CaptureIntent, "songId" | "revision">) {
    const s = this.c.song;
    if (!s) throw new Error("Open a song");
    if (!s.tables.parts[intent.partId])
      throw new Error("Choose a recording part");
    if (intent.sectionId !== null && !s.tables.sections[intent.sectionId])
      throw new Error("Choose a valid recording section");
    if (
      typeof intent.name !== "string" ||
      intent.name.length > 10000 ||
      !Array.isArray(intent.start) ||
      intent.start.length !== 2 ||
      time(intent.start[0], intent.start[1]).join() !== intent.start.join() ||
      cmp(intent.start, [0, 1]) < 0 ||
      (intent.sectionId !== null &&
        cmp(intent.start, sectionLength(s, intent.sectionId)) >= 0)
    )
      throw new Error(
        "Choose a valid capture name and exact placement inside its scope",
      );
    return this.recorder.start({
      ...intent,
      songId: s.id,
      revision: this.c.current!.revision,
    });
  }
  async exportAsset(id: string) {
    const x = await this.library.get(id);
    return { asset: x.asset, base64: base64(await x.blob.arrayBuffer()) };
  }
  async exportBundle() {
    if (!this.c.song) throw new Error("Open a song");
    return this.library.exportBundle(this.c.song);
  }
  async importBundle(text: string, asCopy: boolean, operationId: string) {
    const s = await this.library.stageBundle(text);
    return this.c.import(JSON.stringify(s), asCopy, operationId);
  }
  async rawCapture(id: string) {
    const b = await this.recorder.raw(id);
    return { mime: b.type, base64: base64(await b.arrayBuffer()) };
  }
}
