import { html } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { format } from "./coordinates.ts";
import type { Workbench } from "./workbench.ts";

export function objectsPanel({ s, edit, busy }: Workbench) {
  const { parts, voices, chords, prompts } = s.library;
  // Mute and volume are ordinary table writes: the whole part row is proposed
  // back with one field changed, and Rust validates it like any other edit.
  const part = (id: string, patch: Record<string, unknown>, label: string) => {
    const row = parts.find((p) => p.id === id);
    if (!row) return;
    edit({ kind: "edit", changes: [{ table: "parts", id, value: {
      id: row.id, name: row.name, instrument: row.instrument,
      volume: row.volume, muted: row.muted, ...patch } }] }, label);
  };
  return html`<section class="workbench" aria-label="Musical objects">
    <div class="workbench-head"><h3>Parts</h3><span>${parts.length}</span></div>
    ${parts.length
      ? html`<table class="workbench-table">
          <thead><tr><th>Part</th><th>Instrument</th><th>Voices</th><th>Volume</th><th></th></tr></thead>
          <tbody>${repeat(parts, (p) => p.id, (p) => html`<tr>
            <td>${p.name}</td><td>${p.instrument}</td><td>${p.voices}</td>
            <td><input type="range" min="0" max="1" step="0.05" aria-label=${`${p.name} volume`}
              .value=${String(p.volume)} ?disabled=${busy}
              @change=${(e: Event) => part(p.id, { volume: Number((e.target as HTMLInputElement).value) }, `Set ${p.name} volume`)} /></td>
            <td><button ?disabled=${busy} aria-pressed=${p.muted}
              @click=${() => part(p.id, { muted: !p.muted }, `${p.muted ? "Unmute" : "Mute"} ${p.name}`)}>${p.muted ? "Muted" : "Mute"}</button></td>
          </tr>`)}</tbody></table>`
      : html`<p class="workbench-empty">No parts.</p>`}
    <div class="workbench-head"><h3>Voices</h3><span>${voices.length}</span></div>
    ${voices.length
      ? html`<ul class="workbench-list">${repeat(voices, (v) => v.id, (v) => html`<li>${v.name} · ${v.part}</li>`)}</ul>`
      : html`<p class="workbench-empty">No voices.</p>`}
    <div class="workbench-head"><h3>Chords</h3><span>${chords.length}</span></div>
    ${chords.length
      ? html`<ul class="workbench-list">${repeat(chords, (c) => c.id, (c) =>
          html`<li>${c.label ?? c.name} · on ${c.tonic} · ${c.notes.join(" ")}</li>`)}</ul>`
      : html`<p class="workbench-empty">No chords.</p>`}
    <div class="workbench-head"><h3>Patterns</h3><span>${s.patterns.length}</span></div>
    <ul class="workbench-list">${repeat(s.patterns, (p) => p.id, (p) => html`<li>${p.name} · ${format(p.length)}q</li>`)}</ul>
    <div class="workbench-head"><h3>Prompts</h3><span>${prompts.length}</span></div>
    ${prompts.length
      ? html`<ul class="workbench-list">${repeat(prompts, (p) => p.id, (p) => html`<li><strong>${p.name}</strong> ${p.text}</li>`)}</ul>`
      : html`<p class="workbench-empty">No saved prompts.</p>`}
  </section>`;
}
