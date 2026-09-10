import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { ProfileClient } from "./profile.ts";
export function profilePanel(client: ProfileClient, active: () => string, onSwitch: () => Promise<unknown>) {
  let draft = "";
  return () => {
    const current = active();
    if (!client.loaded) return html`<section class="desktop-profiles" aria-label="Local profiles"><span role="status">Opening profiles…</span></section>`;
    return html`<section class="desktop-profiles" aria-label="Local profiles">
      <div class="desktop-profiles-row">
        <span role="status">Profile · ${current || "none"}</span>
        ${client.profiles.map(p => html`<button ?disabled=${client.busy || p.id === current}
          @click=${() => client.switchTo(p.id, onSwitch)}>${p.id === current ? `✓ ${p.title ?? p.id}` : (p.title ?? p.id)}</button>`)}
        <button @click=${() => client.refresh()}>Refresh</button>
      </div>
      <form @submit=${(e: Event) => { e.preventDefault(); if (draft.trim()) { void client.create(draft.trim()); draft = ""; } }}>
        <label>New profile <input aria-label="New profile ID" .value=${live(draft)}
          @input=${(e: Event) => { draft = (e.target as HTMLInputElement).value; }} /></label>
        <button type="submit" ?disabled=${client.busy}>Create profile</button>
      </form>
      <small>Switching rests audio and the assistant; in-flight agent work stays checkpointed in its profile.</small>
      ${client.error ? html`<p role="alert">${client.error}</p>` : nothing}
    </section>`;
  };
}
