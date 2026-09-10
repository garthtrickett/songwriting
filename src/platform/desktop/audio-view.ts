import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { parse } from "./coordinates.ts";
import type { AudioClient } from "./audio.ts";
export function audioPanel(client: AudioClient) {
  let deviceId: string | null = null, metronome = true, tonic = "48", from = "";
  const play = () => {
    let start = null;
    try { start = from.trim() ? parse(from) : null; } catch (e) { client.error = e instanceof Error ? e.message : String(e); return; }
    const key = Number(tonic);
    void client.play(deviceId, { tonic: Number.isSafeInteger(key) ? key : null, metronome, from: start });
  };
  return () => {
    const s = client.state;
    return html`<section class="desktop-audio" aria-label="Native playback" data-audio-status=${s.status}>
      <div class="desktop-audio-controls">
        <button ?disabled=${client.busy} @click=${play}>${client.busy ? "Preparing…" : s.status === "playing" ? "Restart audition" : "Play sketch"}</button>
        <button @click=${() => client.stop()}>Stop audio</button>
        <label>Output <select aria-label="Audio output" .value=${live(deviceId ?? "")} @change=${(e: Event) => { deviceId = (e.target as HTMLSelectElement).value || null; }}>
          <option value="">System default</option>
          ${deviceId && !client.outputs.some(d => d.id === deviceId) ? html`<option value=${deviceId}>Unavailable output — choose another</option>` : nothing}
          ${client.outputs.map(d => html`<option value=${d.id}>${d.name}</option>`)}
        </select></label>
        <label><input type="checkbox" aria-label="Metronome" .checked=${live(metronome)} @change=${(e: Event) => { metronome = (e.target as HTMLInputElement).checked; }} /> Click</label>
        <label>Key <input aria-label="Playback key (MIDI)" inputmode="numeric" .value=${live(tonic)} @input=${(e: Event) => { tonic = (e.target as HTMLInputElement).value; }} /></label>
        <label>From <input aria-label="Start position in quarters" placeholder="0" .value=${live(from)} @input=${(e: Event) => { from = (e.target as HTMLInputElement).value; }} /></label>
        <button @click=${() => client.devices()}>Refresh outputs</button>
        <span role="status">${s.status} · ${s.sampleRate ? (s.frames / s.sampleRate).toFixed(1) : "0.0"} s${s.revision !== null ? ` · revision ${s.revision}` : ""}</span>
        <meter min="0" max="1" aria-label="Output level" .value=${s.level}></meter>
      </div>
      <small>Native playback · guitar/bass/drums/voice synthesis with expression · changes are heard on next play</small>
      ${s.warning ? html`<p role="status">${s.warning}</p>` : nothing}
      ${client.error || s.error ? html`<p role="alert">${client.error || s.error}</p>` : nothing}
    </section>`;
  };
}
