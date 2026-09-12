import { html } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { repeat } from "lit-html/directives/repeat.js";
import { format, parse } from "./coordinates.ts";
import { fresh, type Workbench } from "./workbench.ts";

export function rhythmPanel() {
  let patternId = "";
  let amount = "1/2";
  let error = "";
  return ({ s, edit, busy, repaint }: Workbench) => {
    const { polyrhythms } = s.library;
    if (!s.patterns.some((p) => p.id === patternId)) patternId = s.patterns[0]?.id ?? "";
    const pattern = s.patterns.find((p) => p.id === patternId);
    // Rotation is an exact musical quantity, so it is parsed to a rational here
    // and rejected in the view before a malformed value reaches the wire.
    const rotate = () => {
      if (!pattern) return;
      try {
        error = "";
        edit({ kind: "rhythm", action: { type: "rotate", patternId, amount: parse(amount) } }, `Rotate ${pattern.name} by ${amount}`);
      } catch (e) { error = String(e instanceof Error ? e.message : e); repaint(); }
    };
    return html`<section class="workbench" aria-label="Rhythm workbench">
      <div class="workbench-head"><h3>Patterns</h3><span>${s.patterns.length}</span></div>
      <table class="workbench-table">
        <thead><tr><th>Pattern</th><th>Cycle</th><th>Reshape</th></tr></thead>
        <tbody>${repeat(s.patterns, (p) => p.id, (p) => html`<tr>
          <td>${p.name}</td><td>${format(p.length)}q</td>
          <td class="workbench-actions">
            <button ?disabled=${busy} title="Copy this pattern so edits do not affect its other placements"
              @click=${() => edit({ kind: "rhythm", action: { type: "variation", patternId: p.id, newId: fresh(), name: `${p.name} variation` } }, `Vary ${p.name}`)}>Vary</button>
          </td></tr>`)}</tbody></table>
      <div class="workbench-head"><h3>Rotate a pattern</h3><span>exact quarter notes</span></div>
      <form class="workbench-form" @submit=${(e: SubmitEvent) => { e.preventDefault(); rotate(); }}>
        <label>Pattern<select aria-label="Pattern to rotate" ?disabled=${busy} .value=${live(patternId)}
          @change=${(e: Event) => { patternId = (e.target as HTMLSelectElement).value; repaint(); }}>
          ${s.patterns.map((p) => html`<option value=${p.id} ?selected=${p.id === patternId}>${p.name}</option>`)}</select></label>
        <label>Amount<input aria-label="Rotate amount" .value=${live(amount)} ?disabled=${busy}
          @input=${(e: Event) => { amount = (e.target as HTMLInputElement).value; }} /></label>
        <button ?disabled=${busy || !pattern}>Rotate</button>
      </form>
      ${error ? html`<p class="workbench-error" role="alert">${error}</p>` : ""}
      <div class="workbench-head"><h3>Polyrhythms</h3><span>${polyrhythms.length}</span></div>
      ${polyrhythms.length
        ? html`<ul class="workbench-list">${repeat(polyrhythms, (p) => p.id, (p) => html`<li>
            <strong>${p.name}</strong> · ${p.section ?? "whole song"} · ${format(p.start)}q for ${format(p.duration)}q
            <ul>${p.lanes.map((lane) => html`<li>${lane.occurrence} · ${lane.divisions} divisions</li>`)}</ul>
          </li>`)}</ul>`
        : html`<p class="workbench-empty">No polyrhythms.</p>`}
    </section>`;
  };
}
