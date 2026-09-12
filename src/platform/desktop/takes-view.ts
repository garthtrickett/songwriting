import { html } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { format } from "./coordinates.ts";
import type { Workbench } from "./workbench.ts";

const seconds = (n: number) => `${n.toFixed(1)} s`;

export function takesPanel({ s }: Workbench) {
  const { takes } = s.library;
  return html`<section class="workbench" aria-label="Recorded takes">
    <div class="workbench-head"><h3>Takes</h3><span>${takes.length} placement${takes.length === 1 ? "" : "s"}</span></div>
    ${takes.length
      ? html`<table class="workbench-table">
          <thead><tr><th>Take</th><th>Part</th><th>Section</th><th>At</th><th>Length</th><th>Gain</th><th>State</th></tr></thead>
          <tbody>${repeat(takes, (t) => `${t.id}/${t.appearanceId ?? ""}`, (t) => html`<tr>
            <td>${t.name}${t.asset ? html` · <em>${t.asset}</em>` : ""}</td>
            <td>${t.part ?? "unassigned"}</td><td>${t.section ?? "whole song"}</td>
            <td>${format(t.at)}q</td><td>${seconds(t.duration)}</td><td>${t.gain.toFixed(2)}</td>
            <td>${t.muted ? "muted" : "audible"}</td>
          </tr>`)}</tbody></table>`
      : html`<p class="workbench-empty">No recorded takes. Recording arrives with native capture.</p>`}
  </section>`;
}
