import { html } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { repeat } from "lit-html/directives/repeat.js";
import { format } from "./coordinates.ts";
import type { Workbench } from "./workbench.ts";

// Writing notes are song metadata, so they travel as a `meta` edit rather than a
// table write. Drafts are held until saved so an incoming snapshot cannot wipe
// half a sentence, matching how the title field behaves.
export function writingPanel() {
  let instructions: string | null = null;
  let preferences: string | null = null;
  return ({ s, edit, busy, repaint }: Workbench) => {
    const { writing, lyrics, phrases } = s.library;
    const draft = {
      instructions: instructions ?? writing.instructions,
      preferences: preferences ?? writing.preferences,
    };
    const dirty = instructions !== null || preferences !== null;
    return html`<section class="workbench" aria-label="Writing">
      <div class="workbench-head"><h3>Guidance</h3>
        <span>${writing.mode} · ${writing.degreeReference} reference · ${writing.bpm} bpm</span></div>
      <form class="workbench-form workbench-writing" @submit=${(e: SubmitEvent) => {
        e.preventDefault();
        edit({ kind: "edit", changes: [{ table: "meta", id: "writing", value: draft }] }, "Save writing notes");
        instructions = null; preferences = null; repaint();
      }}>
        <label>Instructions<textarea aria-label="Writing instructions" rows="3" maxlength="10000" ?disabled=${busy}
          .value=${live(draft.instructions)}
          @input=${(e: Event) => { instructions = (e.target as HTMLTextAreaElement).value; repaint(); }}></textarea></label>
        <label>Preferences<textarea aria-label="Writing preferences" rows="3" maxlength="10000" ?disabled=${busy}
          .value=${live(draft.preferences)}
          @input=${(e: Event) => { preferences = (e.target as HTMLTextAreaElement).value; repaint(); }}></textarea></label>
        <button ?disabled=${busy || !dirty}>Save writing notes</button>
        ${dirty ? html`<button type="button" ?disabled=${busy}
          @click=${() => { instructions = null; preferences = null; repaint(); }}>Discard draft</button>` : ""}
      </form>
      <div class="workbench-head"><h3>Phrases</h3><span>${phrases.length}</span></div>
      ${phrases.length
        ? html`<ul class="workbench-list">${repeat(phrases, (p) => p.id, (p) =>
            html`<li>${p.name} · ${p.section ?? "unplaced"} · ${format(p.start)}q for ${format(p.duration)}q</li>`)}</ul>`
        : html`<p class="workbench-empty">No phrases.</p>`}
      <div class="workbench-head"><h3>Lyrics</h3><span>${lyrics.length}</span></div>
      ${lyrics.length
        ? html`<ul class="workbench-list">${repeat(lyrics, (l) => l.id, (l) =>
            html`<li><strong>${l.text}</strong> · ${l.section ?? "unplaced"} · ${format(l.start)}q</li>`)}</ul>`
        : html`<p class="workbench-empty">No lyrics yet.</p>`}
    </section>`;
  };
}
