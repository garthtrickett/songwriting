import { html } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { format } from "./coordinates.ts";
import { fresh, type Workbench } from "./workbench.ts";

export function structurePanel({ s, edit, busy }: Workbench) {
  const order = s.library.appearances;
  const { markers, annotations } = s.library;
  return html`<section class="workbench" aria-label="Song map">
    <div class="workbench-head"><h3>Song map</h3>
      <span>${order.length} appearance${order.length === 1 ? "" : "s"} · ${s.bars.length} bars</span></div>
    ${order.length
      ? html`<table class="workbench-table">
          <thead><tr><th>Appearance</th><th>Section</th><th>Bars</th><th>Start</th><th>Length</th><th>Arrange</th></tr></thead>
          <tbody>${repeat(order, (a) => a.id, (a, i) => html`<tr>
            <td>${a.name}</td><td>${a.section}</td><td>${a.bars}</td>
            <td>${format(a.start)}q</td><td>${format(a.length)}q</td>
            <td class="workbench-actions">
              <button aria-label=${`Move ${a.name} earlier`} ?disabled=${busy || i === 0}
                @click=${() => edit({ kind: "structure", action: { type: "move", appearanceId: a.id, direction: -1 } }, `Move ${a.name} earlier`)}>↑</button>
              <button aria-label=${`Move ${a.name} later`} ?disabled=${busy || i === order.length - 1}
                @click=${() => edit({ kind: "structure", action: { type: "move", appearanceId: a.id, direction: 1 } }, `Move ${a.name} later`)}>↓</button>
              <button ?disabled=${busy}
                @click=${() => edit({ kind: "structure", action: { type: "repeat", appearanceId: a.id, newId: fresh() } }, `Repeat ${a.name}`)}>Repeat</button>
              <button ?disabled=${busy} title="Copy the section and its music so edits do not affect the original"
                @click=${() => edit({ kind: "structure", action: { type: "variation", appearanceId: a.id, newId: fresh(), name: `${a.section} variation` } }, `Vary ${a.name}`)}>Vary</button>
              <button ?disabled=${busy}
                @click=${() => edit({ kind: "structure", action: { type: "remove", appearanceId: a.id } }, `Remove ${a.name}`)}>Remove</button>
            </td></tr>`)}</tbody></table>`
      : html`<p class="workbench-empty">This song has no arranged sections yet.</p>`}
    <div class="workbench-head"><h3>Markers</h3><span>${markers.length}</span></div>
    ${markers.length
      ? html`<ul class="workbench-list">${repeat(markers, (m) => m.id, (m) => html`<li>${m.name} · ${format(m.at)}q</li>`)}</ul>`
      : html`<p class="workbench-empty">No markers.</p>`}
    <div class="workbench-head"><h3>Annotations</h3><span>${annotations.length}</span></div>
    ${annotations.length
      ? html`<ul class="workbench-list">${repeat(annotations, (a) => `${a.table}/${a.id}/${a.appearanceId}`, (a) =>
          html`<li><em>${a.table}</em> ${a.name} · ${format(a.start)}q for ${format(a.duration)}q</li>`)}</ul>`
      : html`<p class="workbench-empty">No phrases or lyrics are arranged yet.</p>`}
  </section>`;
}
