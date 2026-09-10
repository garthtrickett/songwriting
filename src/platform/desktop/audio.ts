import type { AudioView } from "../../generated/desktop/AudioView.ts";
import type { OutputDevice } from "../../generated/desktop/OutputDevice.ts";
import type { AudioPlay } from "../../generated/desktop/AudioPlay.ts";
import { failure } from "./wire.ts";
export interface AudioTransport {
  status(): Promise<unknown>;
  devices(): Promise<unknown>;
  play(request: AudioPlay): Promise<void>;
  stop(): Promise<void>;
}
export function audioView(input: unknown): AudioView {
  if (!input || typeof input !== "object") throw new Error("Invalid audio status");
  const v = input as AudioView;
  if (!["stopped", "playing", "ended", "error"].includes(v.status) ||
      ![v.generation, v.sampleRate, v.channels, v.frames, v.totalFrames, v.callbacks, v.xruns].every(n => Number.isSafeInteger(n) && n >= 0) ||
      v.frames > v.totalFrames || !(v.revision === null || Number.isSafeInteger(v.revision) && v.revision >= 0) ||
      ![v.device, v.error, v.warning].every(s => s === null || typeof s === "string")) throw new Error("Invalid audio status");
  return v;
}
export function outputDevices(input: unknown): OutputDevice[] {
  if (!Array.isArray(input) || input.some(d => !d || typeof d.id !== "string" || typeof d.name !== "string")) throw new Error("Invalid audio outputs");
  return input;
}
export class AudioClient {
  state: AudioView = { generation: 0, status: "stopped", device: null, sampleRate: 0, channels: 0, frames: 0, totalFrames: 0, callbacks: 0, xruns: 0, warning: null, revision: null, error: null };
  outputs: OutputDevice[] = [];
  error = "";
  busy = false;
  private disposed = false;
  private sequence = 0;
  private action = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  constructor(private transport: AudioTransport) {}
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private notify() { if (!this.disposed) for (const fn of this.listeners) { try { fn(); } catch (e) { console.error("Audio view failed", e); } } }
  async refresh() {
    const sequence = ++this.sequence;
    try {
      const state = audioView(await this.transport.status());
      if (!this.disposed && sequence === this.sequence && state.generation >= this.state.generation) this.state = state;
    } catch (e) { if (!this.disposed && sequence === this.sequence) this.error = failure(e).message; }
    this.notify();
  }
  async connect() {
    await this.devices();
    const poll = async () => {
      await this.refresh();
      if (!this.disposed) this.timer = setTimeout(() => { void poll(); }, 300);
    };
    await poll();
  }
  async devices() {
    try { const outputs = outputDevices(await this.transport.devices()); if (!this.disposed) { this.outputs = outputs; this.error = ""; } }
    catch (e) { if (!this.disposed) this.error = failure(e).message; }
    this.notify();
  }
  async play(deviceId: string | null) {
    if (this.disposed || this.busy) return;
    const action = ++this.action;
    ++this.sequence; this.busy = true; this.error = ""; this.notify();
    try { await this.transport.play({ deviceId, tonic: null, metronome: null, from: null }); }
    catch (e) { if (action === this.action) this.error = failure(e).message; }
    if (action === this.action) this.busy = false;
    await this.refresh();
  }
  async stop() {
    if (this.disposed) return;
    ++this.action; ++this.sequence; this.busy = false; this.error = ""; this.notify();
    try { await this.transport.stop(); }
    catch (e) { this.error = failure(e).message; }
    await this.refresh();
  }
  dispose() { this.disposed = true; ++this.sequence; clearTimeout(this.timer); this.listeners.clear(); }
}
