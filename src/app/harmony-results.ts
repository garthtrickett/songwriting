import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import { chordCandidates, soundingHarmony } from "../song/harmony-analysis.ts";
import { voiceLeading } from "../song/voice-leading.ts";
import { TONIC } from "../song/harmony-pitch.ts";
import { pitchLabel } from "../song/model.ts";
import { parse, type Time } from "../song/time.ts";
export function harmonyResults(c: Controller) {
  let songId = "",
    chordId = "",
    contextId = "",
    at: Time | null = null,
    pair: { source: string; target: string; radius: number } | null = null,
    error = "";
  const run = (fn: () => void) => {
    try {
      fn();
      error = "";
    } catch (e) {
      error = String(e);
    }
    c.notify();
  };
  return () => {
    const s = c.song;
    if (!s) return nothing;
    if (songId !== s.id) {
      songId = s.id;
      chordId = "";
      contextId = "";
      at = null;
      pair = null;
      error = "";
    }
    let chordView: unknown = nothing,
      soundView: unknown = nothing,
      voiceView: unknown = nothing;
    try {
      if (chordId) {
        const h = s.tables.harmony[contextId],
          r = chordCandidates(s, chordId, h?.tonic ?? TONIC, h?.mode ?? s.mode);
        chordView = html`<div aria-label="Chord interpretations">
          <p>
            Current label: ${r.label ?? "unresolved"}. Bass:
            ${r.bass ? pitchLabel(r.bass) : "none"}. Reference
            ${pitchLabel(r.tonic)}. Mode membership:
            ${r.inMode === null ? "mode unrecognised" : r.inMode ? "all tones" : "contains outside tones"}.
          </p>
          ${r.unresolved ? html`<p>No exact match in the analysis vocabulary. Keep explicit notes and an unresolved/custom label.</p>` : r.candidates.map((candidate) => html`<button @click=${() => void c.patchEntity("chords", chordId, { label: candidate.symbol, labelTonic: r.tonic }, "Adopt chord interpretation")}>Use ${candidate.symbol}</button>`)}
          <p class="muted">
            ${r.totalCandidates} possible exact pitch-class interpretations.
            Octave layout, passing tones and context can change how you hear
            them; no label is applied automatically.
          </p>
        </div>`;
      }
      if (at) {
        const r = soundingHarmony(s, at);
        soundView = html`<div aria-label="Sounding harmony">
          <p>
            Context: ${pitchLabel(r.context.tonic)} · ${r.context.mode} ·
            ${r.context.annotation}
          </p>
          ${r.voices.map((v) => html`<p><strong>${v.name}</strong>: ${v.notes.map((n) => pitchLabel(n.pitch!)).join(" + ")}</p>`)}
          <p>
            ${r.candidates.length ? r.candidates.map((c) => c.symbol).join(" / ") : "Unresolved aggregate"}
          </p>
          <p class="muted">
            Includes sounding pedal notes, releases and member attacks.
            Silent/muted notes and voice-scoped rests are respected.
          </p>
        </div>`;
      }
      if (pair) {
        const r = voiceLeading(s, pair.source, pair.target, pair.radius);
        voiceView = html`<div aria-label="Voice-leading comparison">
          <p>
            Total matched motion: ${r.totalMotion} semitones.
            ${r.affectedEvents.length} target events share the proposed voicing.
          </p>
          <table>
            <thead>
              <tr>
                <th>Source member</th>
                <th>Target member</th>
                <th>Notes</th>
                <th>Motion</th>
              </tr>
            </thead>
            <tbody>
              ${r.moves.map(
                (m) =>
                  html`<tr>
                    <td>${m.sourceMemberId ?? "—"}</td>
                    <td>${m.targetMemberId ?? "—"}</td>
                    <td>
                      ${m.from ? pitchLabel(m.from) : "—"} →
                      ${m.to ? pitchLabel(m.to) : "—"}
                    </td>
                    <td>${m.semitones ?? m.status}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>`;
      }
    } catch (e) {
      error = String(e);
    }
    const select = (
      name: string,
      label: string,
      items: { id: string; name: string }[],
    ) =>
      html`<label
        >${label}<select name=${name} aria-label=${label}>
          ${items.map((i) => html`<option value=${i.id}>${i.name}</option>`)}
        </select></label
      >`;
    const chords = Object.values(s.tables.chords);
    return html`<details>
        <summary>Inspect chord interpretations</summary>
        <form
          @submit=${(e: SubmitEvent) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget as HTMLFormElement);
            run(() => {
              chordId = String(f.get("chord"));
              contextId = String(f.get("context"));
            });
          }}
        >
          <div class="field-grid">
            ${select("chord", "Inspect chord", chords)}${select("context", "Interpretation context", [{ id: "", name: "Song tonic I" }, ...Object.values(s.tables.harmony)])}
          </div>
          <button>Inspect chord</button>
        </form>
        ${chordView}
      </details>
      <details>
        <summary>Inspect sounding harmony</summary>
        <form
          @submit=${(e: SubmitEvent) => {
     e.preventDefault();
     const f = new FormData(e.currentTarget as HTMLFormElement);
     run(() => {
       at = parse(String(f.get("at")));
     });
   }}
        >
          <label
            >Harmony position<input
              name="at"
              aria-label="Harmony position"
              value="0" /></label
          ><button>Inspect sounding notes</button>
        </form>
        ${soundView}
      </details>
      <details>
        <summary>Compare voice motion</summary>
        <form
          @submit=${(e: SubmitEvent) => {
     e.preventDefault();
     const f = new FormData(e.currentTarget as HTMLFormElement);
     run(() => {
       pair = {
         source: String(f.get("source")),
         target: String(f.get("target")),
         radius: Number(f.get("radius")),
       };
     });
   }}
        >
          <div class="field-grid">
            ${select("source", "Motion source chord", chords)}${select("target", "Motion target chord", chords)}<label
              >Compare octave radius<input
                name="radius"
                aria-label="Compare octave radius"
                value="1"
            /></label>
          </div>
          <button>Compare voice leading</button>
        </form>
        ${voiceView}
      </details>
      ${error ? html`<p role="alert">${error}</p>` : nothing}`;
  };
}
