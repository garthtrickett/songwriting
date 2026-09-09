import type { Asset } from "../../generated/desktop/Asset.ts";
import type { Capture } from "../../generated/desktop/Capture.ts";
import type { MediaView } from "../../generated/desktop/MediaView.ts";
import type { Summary } from "../../generated/desktop/Summary.ts";
import { failure } from "./wire.ts";
export interface MediaTransport {
  status(): Promise<unknown>;
}
const CAPTURE_STATES = ["recording", "interrupted", "ready"];
const assetId = (id: unknown) => typeof id === "string" && /^[0-9a-f]{64}$/.test(id);
const count = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const text = (s: unknown) => typeof s === "string" || s === null;
function summary(input: unknown): Summary {
  const v = input as Summary;
  if (!v || typeof v !== "object" || ![v.sampleRate, v.channels, v.frames].every(count) ||
      typeof v.peak !== "number" || !Number.isFinite(v.peak) || v.peak < 0 ||
      typeof v.rms !== "number" || !Number.isFinite(v.rms) || v.rms < 0) throw new Error("Invalid media summary");
  return v;
}
function asset(input: unknown): Asset {
  const v = input as Asset;
  if (!v || typeof v !== "object" || !assetId(v.id) || !count(v.bytes) ||
      !(v.audio === null || (typeof v.audio === "object" && summary(v.audio))) || !text(v.error)) throw new Error("Invalid media asset");
  return v;
}
function capture(input: unknown): Capture {
  const v = input as Capture;
  if (!v || typeof v !== "object" || typeof v.id !== "string" || v.id.length === 0 || v.id.length > 64 ||
      !CAPTURE_STATES.includes(v.status) || !count(v.sampleRate) || v.channels < 1 || v.channels > 2 ||
      !count(v.frames) || !(v.assetId === null || assetId(v.assetId)) || !text(v.error)) throw new Error("Invalid media capture");
  return v;
}
export function mediaView(input: unknown): MediaView {
  const v = input as MediaView;
  if (!v || typeof v !== "object" || typeof v.available !== "boolean" || typeof v.decoder !== "string" ||
      !Array.isArray(v.assets) || !Array.isArray(v.captures) || !text(v.error)) throw new Error("Invalid media status");
  return { available: v.available, decoder: v.decoder, assets: v.assets.map(asset), captures: v.captures.map(capture), error: v.error };
}
export class MediaClient {
  state: MediaView = { available: false, decoder: "", assets: [], captures: [], error: null };
  error = "";
  loaded = false;
  private disposed = false;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  constructor(private transport: MediaTransport) {}
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private notify() { if (!this.disposed) for (const fn of this.listeners) { try { fn(); } catch (e) { console.error("Media view failed", e); } } }
  async refresh() {
    const sequence = ++this.sequence;
    try {
      const state = mediaView(await this.transport.status());
      if (!this.disposed && sequence === this.sequence) { this.state = state; this.error = ""; this.loaded = true; }
    } catch (e) { if (!this.disposed && sequence === this.sequence) { this.error = failure(e).message; this.loaded = true; } }
    this.notify();
  }
  async connect() {
    const poll = async () => {
      await this.refresh();
      if (!this.disposed) this.timer = setTimeout(() => { void poll(); }, 2000);
    };
    await poll();
  }
  dispose() { this.disposed = true; ++this.sequence; clearTimeout(this.timer); this.listeners.clear(); }
}
