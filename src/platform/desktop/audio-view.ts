import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { AudioClient } from "./audio.ts";
export function audioPanel(client: AudioClient) {
  let deviceId: string | null = null;
  return () => {
    const s = client.state;
    return html`<section class="desktop-audio" aria-label="Native playback" data-audio-status=${s.status}>
      <div class="desktop-audio-controls">
        <button ?disabled=${client.busy} @click=${() => client.play(deviceId)}>${client.busy ? "Preparing…" : s.status === "playing" ? "Restart audition" : "Play sketch"}</button>
        <button @click=${() => client.stop()}>Stop audio</button>
        <label>Output <select aria-label="Audio output" .value=${live(deviceId ?? "")} @change=${(e: Event) => { deviceId = (e.target as HTMLSelectElement).value || null; }}>
          <option value="">System default</option>
          ${deviceId && !client.outputs.some(d => d.id === deviceId) ? html`<option value=${deviceId}>Unavailable output — choose another</option>` : nothing}
          ${client.outputs.map(d => html`<option value=${d.id}>${d.name}</option>`)}
        </select></label>
        <button @click=${() => client.devices()}>Refresh outputs</button>
        <span role="status">${s.status} · ${s.sampleRate ? (s.frames / s.sampleRate).toFixed(1) : "0.0"} s${s.revision !== null ? ` · revision ${s.revision}` : ""}</span>
      </div>
      <small>Native audition · simple tones in C4 + grouped metronome · changes are heard on next play</small>
      ${s.warning ? html`<p role="status">${s.warning}</p>` : nothing}
      ${client.error || s.error ? html`<p role="alert">${client.error || s.error}</p>` : nothing}
    </section>`;
  };
}
