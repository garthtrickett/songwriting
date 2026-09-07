import { read, list, save } from "../storage/projects.ts";
import { MediaLibrary } from "./library.ts";
import { MAX_ASSET_BYTES } from "../song/media.ts";
import type { Time } from "../song/time.ts";
export interface CaptureIntent {
  songId: string;
  revision: number;
  name: string;
  partId: string;
  sectionId: string | null;
  start: Time;
}
export interface Capture extends CaptureIntent {
  id: string;
  status: "recording" | "ready" | "interrupted";
  mime: string;
  chunks: Blob[];
  assetId: string | null;
  error: string;
  createdAt: number;
}
const LOCK = "songwriting-microphone";
export class Recorder {
  status:
    "idle" | "requesting" | "recording" | "stopping" | "ready" | "failed" =
    "idle";
  error = "";
  captureId: string | null = null;
  private generation = 0;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private capture: Capture | null = null;
  private queue: Promise<void> = Promise.resolve();
  private release: (() => void) | null = null;
  private cancelRequest: (() => void) | null = null;
  private stopped: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    readonly db: IDBDatabase,
    readonly library: MediaLibrary,
    readonly notify: () => void,
  ) {}
  start(intent: CaptureIntent) {
    if (["requesting", "recording", "stopping"].includes(this.status))
      throw new Error("A capture is already active");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined" ||
      !navigator.locks
    )
      throw new Error(
        "Recording needs a secure browser with microphone, MediaRecorder and Web Locks support",
      );
    const generation = ++this.generation;
    this.status = "requesting";
    this.error = "";
    this.captureId = null;
    this.capture = null;
    this.notify();
    const cancelled = new Promise<null>((resolve) => {
      this.cancelRequest = () => resolve(null);
    });
    void navigator.locks
      .request(LOCK, { ifAvailable: true }, async (lock) => {
        if (!lock)
          throw new Error("Another tab is recording; stop that capture first");
        if (generation !== this.generation) return;
        const pending = navigator.mediaDevices.getUserMedia({ audio: true });
        void pending.then(
          (stream) => {
            if (generation !== this.generation)
              stream.getTracks().forEach((t) => t.stop());
          },
          () => {},
        );
        const stream = await Promise.race([pending, cancelled]);
        if (!stream || generation !== this.generation) return;
        this.stream = stream;
        const mime = [
          "audio/webm;codecs=opus",
          "audio/ogg;codecs=opus",
          "audio/mp4",
        ].find((m) => MediaRecorder.isTypeSupported(m));
        const recorder = new MediaRecorder(
          stream,
          mime ? { mimeType: mime } : undefined,
        );
        this.recorder = recorder;
        const capture: Capture = {
          ...structuredClone(intent),
          id: crypto.randomUUID(),
          status: "recording",
          mime: recorder.mimeType,
          chunks: [],
          assetId: null,
          error: "",
          createdAt: Date.now(),
        };
        this.capture = capture;
        this.captureId = capture.id;
        await save(this.db, "captures", capture);
        if (generation !== this.generation) {
          capture.status = "interrupted";
          capture.error = "Cancelled before recording began";
          await save(this.db, "captures", capture);
          return;
        }
        this.queue = Promise.resolve();
        this.stopped = new Promise<void>((resolve) => {
          this.release = resolve;
        });
        recorder.ondataavailable = (e) => {
          if (!e.data.size) return;
          capture.chunks.push(e.data);
          if (
            capture.chunks.reduce((n, c) => n + c.size, 0) > MAX_ASSET_BYTES
          ) {
            this.error = "Recording exceeded 25 MiB; raw capture retained";
            capture.error = this.error;
            if (recorder.state !== "inactive") recorder.stop();
          }
          const snapshot = structuredClone(capture);
          this.queue = this.queue
            .then(() => save(this.db, "captures", snapshot))
            .catch((e) => {
              this.error = `Capture checkpoint failed: ${String(e)}. Keep this tab open and retry saving.`;
              capture.error = this.error;
              if (recorder.state !== "inactive") recorder.stop();
              this.notify();
            });
        };
        recorder.onerror = (e) => {
          this.error = `Recording error: ${e.type}`;
          capture.error = this.error;
          if (recorder.state !== "inactive") recorder.stop();
        };
        recorder.onstop = () => void this.finishCapture(capture);
        for (const track of stream.getTracks())
          track.onended = () => {
            if (recorder.state !== "inactive") recorder.stop();
          };
        recorder.start(1000);
        this.status = "recording";
        this.notify();
        this.timer = setTimeout(() => {
          this.error = "Ten-minute capture limit reached; recording stopped";
          capture.error = this.error;
          void this.stop();
        }, 600000);
        await this.stopped;
      })
      .catch((e) => {
        if (generation === this.generation) {
          this.error = String(e);
          this.status = "failed";
          this.notify();
        }
      })
      .finally(() => {
        if (generation === this.generation || this.stream === null) {
          this.stream?.getTracks().forEach((t) => t.stop());
          this.stream = null;
          this.recorder = null;
        }
      });
    return { status: this.status };
  }
  private async finishCapture(capture: Capture) {
    this.status = "stopping";
    this.notify();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    try {
      await this.queue;
      capture.status = "interrupted";
      await save(this.db, "captures", capture);
      await this.prepare(capture);
      this.status = "ready";
    } catch (e) {
      capture.status = "interrupted";
      capture.error = `${capture.error} ${String(e)}`.trim();
      this.error = capture.error;
      this.status = "failed";
      try {
        await save(this.db, "captures", capture);
      } catch {
        this.error +=
          "; capture remains in memory only: retry saving before leaving";
      }
    } finally {
      this.release?.();
      this.release = null;
      this.notify();
    }
  }
  private async prepare(capture: Capture) {
    if (!capture.chunks.length)
      throw new Error("Capture contains no saved audio chunks");
    const asset = await this.library.import(
      new Blob(capture.chunks, { type: capture.mime }),
      capture.name,
    );
    capture.assetId = asset.id;
    capture.status = "ready";
    capture.chunks = [];
    await save(this.db, "captures", capture);
  }
  async stop() {
    if (this.status === "requesting") {
      this.generation++;
      this.cancelRequest?.();
      this.cancelRequest = null;
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.recorder = null;
      this.status = "idle";
      this.notify();
      return;
    }
    if (this.recorder && this.recorder.state !== "inactive") {
      this.status = "stopping";
      this.recorder.stop();
      this.notify();
    }
    await this.stopped;
  }
  async recover(id: string) {
    if (!navigator.locks)
      throw new Error("Capture recovery requires Web Locks");
    return navigator.locks.request(
      LOCK,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) throw new Error("Stop the active recording before recovery");
        const c =
          this.capture?.id === id
            ? this.capture
            : await read<Capture>(this.db, "captures", id);
        if (!c) throw new Error("Unknown capture");
        if (c.assetId) {
          await this.library.get(c.assetId);
          await save(this.db, "captures", c);
          return c;
        }
        await save(this.db, "captures", c);
        await this.prepare(c);
        this.status = "ready";
        this.error = "";
        this.notify();
        return c;
      },
    );
  }
  async captures() {
    return (await list<Capture>(this.db, "captures")).map(
      ({ chunks, ...c }) => ({
        ...c,
        bytes: chunks.reduce((n, b) => n + b.size, 0),
        chunks: chunks.length,
      }),
    );
  }
  async raw(id: string) {
    const c =
      this.capture?.id === id
        ? this.capture
        : await read<Capture>(this.db, "captures", id);
    if (!c) throw new Error("Unknown capture");
    return c.assetId
      ? (await this.library.get(c.assetId)).blob
      : new Blob(c.chunks, { type: c.mime });
  }
  async discard(id: string) {
    if (!navigator.locks) throw new Error("Capture removal requires Web Locks");
    await navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock)
        throw new Error("Stop the active recording before discarding captures");
      await new Promise<void>((resolve, reject) => {
        const tx = this.db.transaction("captures", "readwrite");
        tx.objectStore("captures").delete(id);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      if (this.capture?.id === id) this.capture = null;
      this.notify();
    });
  }
  get activeTracks() {
    return (
      this.stream?.getTracks().filter((t) => t.readyState === "live").length ??
      0
    );
  }
}
