import type { ProfileView } from "../../generated/desktop/ProfileView.ts";
import { profileList, type ProfileTransport } from "./native.ts";
import { failure } from "./wire.ts";
export class ProfileClient {
  profiles: ProfileView[] = [];
  error = "";
  loaded = false;
  busy = false;
  private disposed = false;
  private sequence = 0;
  private listeners = new Set<() => void>();
  constructor(private transport: ProfileTransport) {}
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private notify() { if (!this.disposed) for (const fn of this.listeners) { try { fn(); } catch (e) { console.error("Profile view failed", e); } } }
  async refresh() {
    const sequence = ++this.sequence;
    try {
      const profiles = profileList(await this.transport.list());
      if (!this.disposed && sequence === this.sequence) { this.profiles = profiles; this.loaded = true; }
    } catch (e) { if (!this.disposed && sequence === this.sequence) { this.error = failure(e).message; this.loaded = true; } }
    this.notify();
  }
  async connect() { await this.refresh(); }
  async create(id: string) {
    if (this.disposed || this.busy) return;
    this.busy = true; this.error = ""; this.notify();
    try { await this.transport.create(id); } catch (e) { this.error = failure(e).message; }
    this.busy = false;
    await this.refresh();
  }
  async switchTo(id: string, onSwitched: () => Promise<unknown>) {
    if (this.disposed || this.busy) return;
    this.busy = true; this.error = ""; this.notify();
    try { await this.transport.switchTo(id); await onSwitched(); }
    catch (e) { this.error = failure(e).message; }
    this.busy = false;
    await this.refresh();
  }
  dispose() { this.disposed = true; ++this.sequence; this.listeners.clear(); }
}
