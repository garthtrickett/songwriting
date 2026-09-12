import { html } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import type { Workbench } from "./workbench.ts";

const TUNING = (tuning: number[]) => tuning.map((t) => `${t >= 0 ? "+" : ""}${t}`).join(" ");

export function tabPanel({ s }: Workbench) {
  const { fretted } = s.library;
  return html`<section class="workbench" aria-label="Guitar and bass arrangements">
    <div class="workbench-head"><h3>Fretted instruments</h3><span>${fretted.length}</span></div>
    ${fretted.length
      ? html`<table class="workbench-table">
          <thead><tr><th>Instrument</th><th>Part</th><th>Tuning</th><th>Capo</th><th>Max fret</th><th>Hand span</th><th>Fingerings</th></tr></thead>
          <tbody>${repeat(fretted, (f) => f.id, (f) => html`<tr>
            <td>${f.name}</td><td>${f.part}</td><td><code>${TUNING(f.tuning)}</code></td>
            <td>${f.capo}</td><td>${f.maxFret}</td><td>${f.handSpan}</td><td>${f.fingerings}</td>
          </tr>`)}</tbody></table>`
      : html`<p class="workbench-empty">No fretted instruments are configured for this song.</p>`}
    <p class="workbench-note">Rendered tablature and fret-position choices read a parameterized
      analysis that is not on the desktop wire yet; the instruments and their fingering counts come
      from accepted state.</p>
  </section>`;
}
