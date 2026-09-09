import type { Action } from "../../generated/desktop/Action.ts";
import type { EditRequest } from "../../generated/desktop/EditRequest.ts";
import { failure, snapshot, type Snapshot } from "./wire.ts";

export interface Transport {
  open(): Promise<unknown>;
  dispatch(request: EditRequest): Promise<unknown>;
  listen(changed: (value: unknown) => void): Promise<() => void>;
}
export class DesktopClient {
  state: Snapshot | null = null;
  status: "connecting" | "ready" | "saving" | "offline" = "connecting";
  error = "";
  pending: EditRequest | null = null;
  private listeners = new Set<() => void>();
  private unlisten: (() => void) | undefined;
  private connecting: Promise<void> | undefined;
  private disposed = false;
  private buffered: Snapshot | null = null;
  constructor(private transport: Transport, private makeId: () => string = () => crypto.randomUUID()) {}
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private notify() {
    for (const fn of this.listeners) {
      try { fn(); } catch (e) { console.error("Desktop view failed to render", e); }
    }
  }
  private receive(value: unknown) {
    if (this.disposed) return;
    try {
      const next = snapshot(value);
      if (this.status === "connecting") {
        if (!this.buffered || next.epoch !== this.buffered.epoch || next.revision >= this.buffered.revision) this.buffered = next;
      } else if (this.state?.epoch === next.epoch && next.revision >= this.state.revision) {
        this.state = next; this.notify();
      }
    } catch (e) { this.error = failure(e).message; this.status = "offline"; this.notify(); }
  }
  async connect(): Promise<void> {
    if (this.disposed || this.status === "saving") return;
    if (this.connecting) return this.connecting;
    this.connecting = this.refresh().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async refresh() {
    this.status = "connecting"; this.buffered = null; this.notify();
    try {
      // Subscribe before requesting a snapshot so a concurrent edit isn't lost.
      if (!this.unlisten) {
        const stop = await this.transport.listen((v) => this.receive(v));
        if (this.disposed) { stop(); return; }
        this.unlisten = stop;
      }
      const current = snapshot(await this.transport.open());
      if (this.disposed) return;
      const buffered = this.buffered as Snapshot | null;
      this.state = buffered?.epoch === current.epoch && buffered.revision > current.revision ? buffered : current;
      this.status = "ready";
      this.error = this.pending ? "A previous save could not be confirmed. Retry that same edit to check its receipt." : "";
    } catch (e) { this.status = "offline"; this.error = failure(e).message; }
    this.notify();
  }
  async edit(action: Action, base: Snapshot, label: string): Promise<boolean> {
    if (this.pending || this.status !== "ready") return false;
    this.pending = { protocol: 1, epoch: base.epoch, expectedRevision: base.revision,
      operationId: this.makeId(), label, action };
    return this.retry();
  }
  async retry(): Promise<boolean> {
    const request = this.pending;
    if (!request || this.status === "saving" || this.status === "connecting" || this.disposed) return false;
    this.status = "saving"; this.error = ""; this.notify();
    try {
      const next = snapshot(await this.transport.dispatch(request));
      if (next.epoch !== request.epoch) throw new Error("The application session changed before confirming this save.");
      if (!this.state || next.epoch !== this.state.epoch || next.revision >= this.state.revision) this.state = next;
      this.pending = null; this.status = "ready"; this.notify(); return true;
    } catch (e) {
      const f = failure(e);
      // Storage/transport failure may occur after commit. Keep the exact request
      // for receipt-first retry; never silently rebase it onto a newer revision.
      const rejected = ["invalid", "conflict", "undo_conflict", "unsupported", "operation_reused", "missing", "session", "protocol", "scope", "closing"].includes(f.code);
      if (rejected) this.pending = null;
      this.status = "offline";
      const message = rejected ? f.message : `Could not confirm the save: ${f.message}. Reconnect and retry the same edit.`;
      await this.connect();
      this.error = message; this.notify(); return false;
    }
  }
  dispose() { this.disposed = true; this.unlisten?.(); this.unlisten = undefined; this.listeners.clear(); }
}
