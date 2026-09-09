import { html, nothing } from "lit-html";
import type { MediaClient } from "./media.ts";
const short = (id: string) => id.slice(0, 12);
export function mediaPanel(client: MediaClient) {
  return () => {
    const s = client.state;
    if (!client.loaded) return html`<section class="desktop-media" aria-label="Preserved recordings"><span role="status">Opening media library…</span></section>`;
    return html`<section class="desktop-media" aria-label="Preserved recordings" data-media-available=${s.available}>
      <div class="desktop-media-controls">
        <span role="status">${s.available ? `${s.assets.length} preserved · ${s.captures.length} captures · ${s.decoder}` : "Media library unavailable"}</span>
        <button @click=${() => client.refresh()}>Refresh media</button>
      </div>
      <small>Read-only in this preview · recording controls and take placement arrive in D4</small>
      ${s.assets.map(a => html`<p>${short(a.id)} · ${(a.bytes / 1024).toFixed(1)} KiB${a.audio ? ` · ${(a.audio.frames / a.audio.sampleRate).toFixed(1)} s ${a.audio.channels === 2 ? "stereo" : "mono"}` : ""}${a.error ? ` · ${a.error}` : ""}</p>`)}
      ${s.captures.map(c => html`<p>${c.id} · ${c.status} · ${(c.frames / (c.sampleRate || 1)).toFixed(1)} s${c.error ? ` · ${c.error}` : ""}</p>`)}
      ${client.error || s.error ? html`<p role="alert">${client.error || s.error}</p>` : nothing}
    </section>`;
  };
}
