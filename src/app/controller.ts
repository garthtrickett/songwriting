import { MediaWorkspace } from "../media/workspace.ts";
import { historyStacks } from "../song/history.ts";
import { sectionSpans } from "../song/arrangement.ts";
import { value } from "../song/time.ts";
import { commit, list, read, save } from "../storage/projects.ts";
import type { Change, Command, Envelope, Mutation } from "../song/commands.ts";
import {
  emptySong,
  type Song,
  type Table,
  type Entity,
} from "../song/model.ts";
import { sounds } from "../song/timeline.ts";
import { validateSong } from "../song/validate.ts";
import { AudioEngine } from "../audio/engine.ts";
export interface Selection {
  table: Table;
  id: string;
}
export class Controller {
  current: Envelope | null = null;
  songs: Envelope[] = [];
  deletedSongs: Envelope[] = [];
  selection: Selection | null = null;
  error = "";
  incoming = "";
  zoom = 32;
  jumpTo = 0;
  navigationVersion = 0;
  pending = 0;
  failed: Mutation | null = null;
  audio: AudioEngine;
  media: MediaWorkspace;
  private listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private fieldQueue: Promise<unknown> = Promise.resolve();
  private fieldOperations = new Set<string>();
  constructor(readonly db: IDBDatabase) {
    this.media = new MediaWorkspace(this);
    this.audio = new AudioEngine(async id => (await this.media.library.get(id)).blob);
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("songwriting-edits");
      this.channel.onmessage = () => void this.refresh();
    }
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  notify() {
    this.listeners.forEach((fn) => fn());
  }
  get song() {
    return this.current?.song ?? null;
  }
  async init() {
    await this.refresh();
    const setting = await read<{ id: string; songId: string }>(
      this.db,
      "settings",
      "current",
    );
    const first =
      this.songs.find((s) => s.id === setting?.songId) ?? this.songs[0];
    if (first) await this.open(first.id);
    const audio = await read<{ id: string; tonic: number; metronome: boolean }>(
      this.db,
      "settings",
      "audio",
    );
    if (audio) {
      this.audio.tonic = audio.tonic;
      this.audio.metronome = audio.metronome;
    }
    this.audio.onChange = () => this.notify();
  }
  async refresh() {
    const all = await list<Envelope>(this.db, "songs");
    this.songs = all
      .filter((e) => e.song)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    this.deletedSongs = all.filter((e) => !e.song);
    if (this.current) {
      const fresh = await read<Envelope>(this.db, "songs", this.current.id);
      if (fresh && fresh.revision !== this.current.revision) {
        this.audio.stop();
        this.current = fresh;
        this.incoming = `Incoming revision ${fresh.revision}: ${fresh.history.at(-1)?.label ?? "Song changed"}`;
        this.pruneSelection();
      }
    }
    this.notify();
  }
  async open(id: string) {
    await this.media.recorder.stop();
    this.audio.stop();
    this.current = (await read<Envelope>(this.db, "songs", id)) ?? null;
    this.selection = null;
    this.incoming = "";
    this.jumpTo = 0;
    this.navigationVersion++;
    await save(this.db, "settings", { id: "current", songId: id });
    this.notify();
  }
  navigate(zoom: number, appearanceId?: string) {
    if (!Number.isFinite(zoom) || zoom < 4 || zoom > 128)
      throw new Error("Zoom must be 4–128 pixels per quarter note");
    if (appearanceId) {
      const a =
        this.song && sectionSpans(this.song).find((a) => a.id === appearanceId);
      if (!a) throw new Error("Unknown section appearance");
      this.jumpTo = value(a.start);
      this.select({ table: "arrangement", id: a.id });
    }
    this.zoom = zoom;
    this.navigationVersion++;
    this.notify();
  }
  historyAction(action: "undo" | "redo") {
    const targetId = historyStacks(this.current?.history ?? [])[action].at(-1);
    if (!targetId)
      return Promise.resolve({
        ok: false as const,
        error: `Nothing to ${action}`,
      });
    return this.edit(
      { kind: "undo", targetId },
      action === "undo" ? "Undo latest edit" : "Redo latest edit",
    );
  }
  private pruneSelection() {
    if (
      this.selection &&
      !this.song?.tables[this.selection.table][this.selection.id]
    )
      this.selection = null;
  }
  select(s: Selection | null) {
    this.selection = s;
    this.notify();
  }
  async create(
    title = "Untitled idea",
    id: string = crypto.randomUUID(),
    operationId: string = crypto.randomUUID(),
  ) {
    const song = emptySong(id, title);
    const result = await this.mutate({
      songId: song.id,
      expectedRevision: 0,
      operationId,
      label: "Create song",
      command: { kind: "replace", song },
    });
    if (result.ok) await this.open(song.id);
    return result;
  }
  // Queue user field intentions, not stale whole-entity snapshots. Only this
  // queue's accepted operations may advance the captured revision automatically.
  // A foreign edit still reaches commit with the old revision and is rejected.
  patchEntity(
    table: Table,
    id: string,
    fields: Record<string, unknown>,
    label: string,
    captured = this.current,
  ) {
    return this.queueFields((s) => {
      const entity = s.tables[table][id];
      if (!entity) throw new Error("The edited object no longer exists");
      return [{ table, id, value: { ...entity, ...fields } }];
    }, label, captured);
  }
  patchTitle(title: string) {
    return this.queueFields(
      () => [{ table: "meta", id: "title", value: title }],
      "Rename song",
    );
  }
  private queueFields(build: (song: Song) => Change[], label: string, captured = this.current) {
    if (!captured?.song)
      return Promise.resolve({
        ok: false as const,
        error: "Open a song first",
      });
    const operationId = crypto.randomUUID();
    this.pending++;
    this.notify();
    const task = this.fieldQueue.then(async () => {
      const live = this.current;
      const followsOwnEdits =
        live?.id === captured.id &&
        live.song &&
        live.revision >= captured.revision &&
        live.history
          .filter((h) => h.revision > captured.revision)
          .every((h) => this.fieldOperations.has(h.operationId));
      const base = followsOwnEdits ? live! : captured;
      let changes: Change[];
      try {
        changes = build(base.song!);
      } catch (error) {
        this.pending--;
        this.error = String(error);
        this.notify();
        return { ok: false as const, error: this.error };
      }
      this.pending--;
      const result = await this.mutate({
        songId: base.id,
        expectedRevision: base.revision,
        operationId,
        label,
        command: { kind: "edit", changes },
      });
      if (result.ok) this.fieldOperations.add(operationId);
      return result;
    });
    this.fieldQueue = task.catch(() => {});
    return task;
  }
  edit(command: Command, label: string) {
    if (!this.current)
      return Promise.resolve({
        ok: false as const,
        error: "Open a song first",
      });
    return this.mutate({
      songId: this.current.id,
      expectedRevision: this.current.revision,
      operationId: crypto.randomUUID(),
      label,
      command,
    });
  }
  mutate(
    m: Mutation,
  ): Promise<{ ok: true; value: Envelope } | { ok: false; error: string }> {
    if (!m?.command || typeof m.songId !== "string")
      return Promise.resolve({ ok: false, error: "Invalid mutation" });
    this.pending++;
    this.notify();
    const task = this.queue.then(async () => {
      // Expand before committing, so an unrenderable density cannot break every future reload.
      if (m.command.kind === "replace") {
        const v = validateSong(m.command.song);
        if (v.ok)
          try {
            sounds(v.value);
          } catch (e) {
            this.pending--;
            this.error = String(e);
            this.notify();
            return { ok: false as const, error: String(e) };
          }
      }
      const result = await commit(this.db, m);
      this.pending--;
      if (result.ok) {
        this.error = "";
        this.failed = null;
        this.audio.stop();
        if (this.current?.id === m.songId) {
          this.current = result.value;
          this.pruneSelection();
        }
        this.channel?.postMessage({ id: m.songId });
        await this.refresh();
      } else {
        this.error = result.error;
        this.failed = m;
        this.notify();
      }
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async import(
    text: string,
    asCopy: boolean,
    operationId: string = crypto.randomUUID(),
  ) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON");
    }
    const valid = validateSong(parsed);
    if (!valid.ok) throw new Error(valid.error);
    const s = valid.value;
    if (asCopy) s.id = `import-${operationId}`;
    const existing = await read<Envelope>(this.db, "songs", s.id);
    if (
      existing &&
      !existing.history.some((h) => h.operationId === operationId)
    )
      throw new Error(
        "Song ID already exists. Import as a copy or explicitly replace through document edits.",
      );
    const r = await this.mutate({
      songId: s.id,
      expectedRevision: 0,
      operationId,
      label: "Import song",
      command: { kind: "replace", song: s },
    });
    if (r.ok) await this.open(s.id);
    return r;
  }
  export() {
    if (!this.song) throw new Error("No song open");
    return JSON.stringify(this.song, null, 2);
  }
  dispose() {
    void this.media.recorder.stop();
    this.audio.dispose();
    this.channel?.close();
    this.listeners.clear();
    this.db.close();
  }
  entity(): Entity | null {
    const sel = this.selection;
    return sel && this.song
      ? (this.song.tables[sel.table][sel.id] ?? null)
      : null;
  }
}
