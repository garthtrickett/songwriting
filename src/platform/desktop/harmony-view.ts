import { html } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { repeat } from "lit-html/directives/repeat.js";
import { format } from "./coordinates.ts";
import { fresh, type Workbench } from "./workbench.ts";

// Form state lives in the closure, not in the render body: a repaint arrives on
// every accepted edit and must not throw away a half-filled form.
export function harmonyPanel() {
  let patternId = "";
  let steps = 1;
  return ({ s, edit, busy, repaint }: Workbench) => {
    const regions = s.library.harmony;
    if (!s.patterns.some((p) => p.id === patternId)) patternId = s.patterns[0]?.id ?? "";
    const pattern = s.patterns.find((p) => p.id === patternId);
    return html`<section class="workbench" aria-label="Harmony workbench">
      <div class="workbench-head"><h3>Harmonic regions</h3><span>${regions.length}</span></div>
      ${regions.length
        ? html`<table class="workbench-table">
            <thead><tr><th>Region</th><th>Section</th><th>Tonic</th><th>Mode</th><th>Start</th><th>Length</th><th>Note</th></tr></thead>
            <tbody>${repeat(regions, (r) => r.id, (r) => html`<tr>
              <td>${r.name}</td><td>${r.section ?? "whole song"}</td><td>${r.tonic}</td><td>${r.mode}</td>
              <td>${format(r.start)}q</td><td>${format(r.duration)}q</td><td>${r.annotation}</td>
            </tr>`)}</tbody></table>`
        : html`<p class="workbench-empty">No harmonic regions. The song key applies throughout.</p>`}
      <div class="workbench-head"><h3>Transpose a pattern</h3><span>by scale degree</span></div>
      <form class="workbench-form" @submit=${(e: SubmitEvent) => {
        e.preventDefault();
        if (!pattern) return;
        edit({ kind: "harmony", action: { type: "transpose", patternId, newId: fresh(), steps, semitones: 0 } },
          `Transpose ${pattern.name} by ${steps}`);
      }}>
        <label>Pattern<select aria-label="Pattern to transpose" ?disabled=${busy} .value=${live(patternId)}
          @change=${(e: Event) => { patternId = (e.target as HTMLSelectElement).value; repaint(); }}>
          ${s.patterns.map((p) => html`<option value=${p.id} ?selected=${p.id === patternId}>${p.name}</option>`)}</select></label>
        <label>Steps<input type="number" aria-label="Transpose steps" min="-14" max="14" step="1" .value=${live(String(steps))}
          ?disabled=${busy} @input=${(e: Event) => { steps = Number((e.target as HTMLInputElement).value); }} /></label>
        <button ?disabled=${busy || !pattern}>Transpose into a new pattern</button>
      </form>
      <p class="workbench-note">Transposing copies the pattern, so the original stays as written.</p>
    </section>`;
  };
}
