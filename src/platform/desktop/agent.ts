import type { AgentConfig } from "../../generated/desktop/AgentConfig.ts";
import type { AgentView } from "../../generated/desktop/AgentView.ts";
import { failure } from "./wire.ts";
export interface AgentTransport {
  status(): Promise<unknown>;
  configure(config: AgentConfig): Promise<void>;
  start(prompt: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
}
export function agentView(value: unknown): AgentView {
  if (!value || typeof value !== "object") throw new Error("Invalid agent status");
  const v = value as AgentView;
  if (!(v.configuredModel === null || typeof v.configuredModel === "string")) throw new Error("Invalid agent model");
  if (v.task !== null) {
    const t = v.task;
    if (!t || ![t.id, t.status, t.prompt, t.model, t.message].every((s) => typeof s === "string") ||
      !["running", "interrupted", "cancelled", "completed", "failed"].includes(t.status) || !Number.isInteger(t.rounds) || t.rounds < 0 || t.rounds > 12) throw new Error("Invalid agent task");
  }
  return v;
}
export class AgentClient {
  state: AgentView = { configuredModel: null, task: null };
  error = "";
  busy = false;
  private disposed = false;
  private refreshSequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  constructor(private transport: AgentTransport) {}
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private notify() { for (const fn of this.listeners) { try { fn(); } catch (e) { console.error("Agent view failed", e); } } }
  async refresh() {
    const sequence = ++this.refreshSequence;
    try { const next = agentView(await this.transport.status()); if (!this.disposed && sequence === this.refreshSequence) this.state = next; }
    catch (e) { if (!this.disposed && sequence === this.refreshSequence) this.error = failure(e).message; }
    if (!this.disposed) this.notify();
  }
  async connect() {
    await this.refresh();
    if (!this.disposed) this.timer = setTimeout(() => { void this.connect(); }, 700);
  }
  async act(action: () => Promise<void>): Promise<boolean> {
    if (this.busy || this.disposed) return false;
    this.busy = true; this.error = ""; this.notify();
    let ok = false;
    try { await action(); ok = true; } catch (e) { this.error = failure(e).message; }
    await this.refresh(); this.busy = false; if (!this.disposed) this.notify(); return ok;
  }
  configure(config: AgentConfig) { return this.act(() => this.transport.configure(config)); }
  start(prompt: string) { return this.act(() => this.transport.start(prompt)); }
  resume(id: string) { return this.act(() => this.transport.resume(id)); }
  cancel(id: string) { return this.act(() => this.transport.cancel(id)); }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.listeners.clear(); }
}
