import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import type { MusicalEvent } from "../song/model.ts";
import { format, parse } from "../song/time.ts";
import { actions } from "./actions.ts";
export function eventFields(c: Controller) {
  const handle = actions(c);
  const editEvent = (patch: Partial<MusicalEvent>) =>
    handle(() => {
      const sel = c.selection;
      if (!sel || sel.table !== "events") return;
      const e = c.song!.tables.events[sel.id]!;
      return c.patchEntity("events", e.id, patch, "Edit note");
    });
  const fields = (e: MusicalEvent) =>
    html` <div class="field-grid">
      <label
        >Event<select
          aria-label="Event kind"
          .value=${e.kind}
          @change=${(ev: Event) => {
            const kind = (ev.target as HTMLSelectElement)
              .value as MusicalEvent["kind"];
            void editEvent({
              kind,
              chordId:
                kind === "chord"
                  ? (Object.keys(c.song!.tables.chords)[0] ?? null)
                  : null,
              performance: [],
            })();
          }}
        >
          ${["note", "chord", "drum", "rest"].map(
            (k) => html`<option>${k}</option>`,
          )}
        </select></label
      >
      <label
        >Pattern<select
          .value=${e.patternId}
          @change=${(ev: Event) =>
            void editEvent({
              patternId: (ev.target as HTMLSelectElement).value,
            })()}
        >
          ${Object.values(c.song!.tables.patterns).map(
            (p) => html`<option value=${p.id}>${p.name}</option>`,
          )}
        </select></label
      >
      <label
        >Start · quarter notes<input
          aria-label="Note start"
          .value=${format(e.start)}
          @change=${(ev: Event) =>
            void handle(() =>
              editEvent({
                start: parse((ev.target as HTMLInputElement).value),
              })(),
            )()}
      /></label>
      <label
        >Duration<input
          aria-label="Note duration"
          .value=${format(e.duration)}
          @change=${(ev: Event) =>
            void handle(() =>
              editEvent({
                duration: parse((ev.target as HTMLInputElement).value),
              })(),
            )()}
      /></label>
      ${e.kind === "note"
        ? html`<label
              >Degree<input
                type="number"
                min="1"
                max="7"
                .value=${String(e.pitch.degree)}
                @change=${(ev: Event) =>
                  void editEvent({
                    pitch: {
                      ...e.pitch,
                      degree: Number((ev.target as HTMLInputElement).value),
                    },
                  })()} /></label
            ><label
              >Alteration<input
                type="number"
                min="-4"
                max="4"
                .value=${String(e.pitch.alteration)}
                @change=${(ev: Event) =>
                  void editEvent({
                    pitch: {
                      ...e.pitch,
                      alteration: Number((ev.target as HTMLInputElement).value),
                    },
                  })()} /></label
            ><label
              >Octave<input
                type="number"
                min="-5"
                max="5"
                .value=${String(e.pitch.octave)}
                @change=${(ev: Event) =>
                  void editEvent({
                    pitch: {
                      ...e.pitch,
                      octave: Number((ev.target as HTMLInputElement).value),
                    },
                  })()}
            /></label>`
        : nothing}
      ${e.kind === "chord"
        ? html`<label
            >Chord<select
              .value=${e.chordId ?? ""}
              @change=${(ev: Event) =>
                void editEvent({
                  chordId: (ev.target as HTMLSelectElement).value,
                  performance: [],
                })()}
            >
              ${Object.values(c.song!.tables.chords).map(
                (ch) =>
                  html`<option value=${ch.id}>
                    ${ch.label ?? "?"} · ${ch.name}
                  </option>`,
              )}
            </select></label
          >`
        : nothing}
      ${e.kind === "drum"
        ? html`<label
            >Drum<select
              .value=${e.drum}
              @change=${(ev: Event) =>
                void editEvent({
                  drum: (ev.target as HTMLSelectElement)
                    .value as MusicalEvent["drum"],
                })()}
            >
              ${["kick", "snare", "hat"].map(
                (k) => html`<option>${k}</option>`,
              )}
            </select></label
          >`
        : nothing}
      <label
        >Accent<input
          type="number"
          min="0"
          max="1"
          step="0.1"
          .value=${String(e.accent)}
          @change=${(ev: Event) =>
            void editEvent({
              accent: Number((ev.target as HTMLInputElement).value),
            })()}
      /></label>
      <label
        >Articulation<select
          .value=${e.articulation}
          @change=${(ev: Event) =>
            void editEvent({
              articulation: (ev.target as HTMLSelectElement)
                .value as MusicalEvent["articulation"],
            })()}
        >
          ${["normal", "staccato", "sustain", "muted", "ghost"].map(
            (k) => html`<option>${k}</option>`,
          )}
        </select></label
      >
    </div>`;
  return fields;
}
