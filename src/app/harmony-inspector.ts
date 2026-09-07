import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { Controller } from "./controller.ts";
import {
  type HarmonicRegion,
  type MusicalEvent,
  type Performance,
  pitchLabel,
} from "../song/model.ts";
import { format, parse, ZERO } from "../song/time.ts";
export function harmonicRegionEditor(c: Controller) {
  type Draft = {
    value: HarmonicRegion;
    start: string;
    duration: string;
    revision: number;
    dirty: boolean;
  };
  const drafts = new Map<string, Draft>();
  return (h: HarmonicRegion) => {
    const key = `${c.song!.id}/${h.id}`;
    let d = drafts.get(key);
    if (!d || !d.dirty) {
      d = {
        value: structuredClone(h),
        start: format(h.start),
        duration: format(h.duration),
        revision: c.current!.revision,
        dirty: false,
      };
      drafts.set(key, d);
    }
    const draft = d;
    const field = (
      key: "start" | "duration" | "mode" | "annotation",
      label: string,
    ) =>
      html`<label
        >${label}<input
          aria-label=${label}
          .value=${live(key === "start" || key === "duration" ? draft[key] : draft.value[key])}
          @input=${(e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            if (key === "start" || key === "duration") draft[key] = v;
            else draft.value[key] = v;
            draft.dirty = true;
          }}
      /></label>`;
    return html`<form
      @submit=${async (e: SubmitEvent) => {
        e.preventDefault();
        try {
          const r = await c.mutate({
            songId: c.song!.id,
            expectedRevision: draft.revision,
            operationId: crypto.randomUUID(),
            label: "Edit harmonic region",
            command: {
              kind: "edit",
              changes: [
                {
                  table: "harmony",
                  id: h.id,
                  value: {
                    ...draft.value,
                    start: parse(draft.start),
                    duration: parse(draft.duration),
                  },
                },
              ],
            },
          });
          if (r.ok) draft.dirty = false;
        } catch (error) {
          c.error = String(error);
        }
        c.notify();
      }}
    >
      <div class="field-grid">
        <label
          >Harmonic scope<select
            aria-label="Harmonic scope"
            .value=${live(draft.value.sectionId ?? "")}
            @change=${(e: Event) => {
              draft.value.sectionId =
                (e.target as HTMLSelectElement).value || null;
              draft.dirty = true;
            }}
          >
            <option value="">Global</option>
            ${Object.values(c.song!.tables.sections).map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select></label
        >${field("start", "Context start")}${field("duration", "Context duration")}${field("mode", "Context mode")}${field("annotation", "Harmonic annotation")}${(
          ["degree", "alteration", "octave"] as const
        ).map(
          (k) =>
            html`<label
              >Context tonic ${k}<input
                type="number"
                aria-label=${`Context tonic ${k}`}
                .value=${live(String(draft.value.tonic[k]))}
                @input=${(e: Event) => {
                  draft.value.tonic[k] = Number(
                    (e.target as HTMLInputElement).value,
                  );
                  draft.dirty = true;
                }}
            /></label>`,
        )}
      </div>
      <button>Save harmonic region</button
      ><button
        type="button"
        @click=${() => {
          drafts.delete(key);
          c.notify();
        }}
      >
        Reload saved region
      </button>
      <p role="status">
        ${draft.dirty && draft.revision !== c.current!.revision ? "Song changed. Your context draft is preserved; reload or resolve before saving." : "Contexts describe harmony; saving never changes notes."}
      </p>
    </form>`;
  };
}
export function memberPerformanceEditor(c: Controller) {
  type Row = {
    memberId: string;
    offset: string;
    duration: string;
    gain: string;
    articulation: string;
  };
  type Draft = {
    rows: Row[];
    event: MusicalEvent;
    revision: number;
    dirty: boolean;
  };
  const drafts = new Map<string, Draft>();
  return (event: MusicalEvent) => {
    if (event.kind !== "chord") return nothing;
    const key = `${c.song!.id}/${event.id}`;
    let d = drafts.get(key);
    if (!d || !d.dirty) {
      d = {
        event: structuredClone(event),
        revision: c.current!.revision,
        dirty: false,
        rows: c.song!.tables.chords[event.chordId!]!.notes.map((n) => {
          const m = event.performance.find((m) => m.memberId === n.id);
          return {
            memberId: n.id,
            offset: format(m?.offset ?? ZERO),
            duration: format(m?.duration ?? event.duration),
            gain: String(m?.gain ?? 1),
            articulation: m?.articulation ?? "inherit",
          };
        }),
      };
      drafts.set(key, d);
    }
    const draft = d;
    return html`<details open>
      <summary>Independent chord members</summary>
      <form
        @submit=${async (e: SubmitEvent) => {
          e.preventDefault();
          try {
            const performance: Performance[] = draft.rows.map((r) => ({
              memberId: r.memberId,
              offset: parse(r.offset),
              duration: parse(r.duration),
              gain: Number(r.gain),
              articulation: r.articulation as Performance["articulation"] &
                string,
            }));
            const r = await c.mutate({
              songId: c.song!.id,
              expectedRevision: draft.revision,
              operationId: crypto.randomUUID(),
              label: "Edit chord member performance",
              command: {
                kind: "edit",
                changes: [
                  {
                    table: "events",
                    id: event.id,
                    value: { ...draft.event, performance },
                  },
                ],
              },
            });
            if (r.ok) draft.dirty = false;
          } catch (error) {
            c.error = String(error);
          }
          c.notify();
        }}
      >
        ${draft.rows.map(
          (r) =>
            html`<fieldset>
              <legend>
                ${r.memberId} ·
                ${c.song!.tables.chords[event.chordId!]!.notes.find((n) => n.id === r.memberId) ? pitchLabel(c.song!.tables.chords[event.chordId!]!.notes.find((n) => n.id === r.memberId)!.pitch) : "member changed"}
              </legend>
              <div class="field-grid">
                ${(["offset", "duration", "gain"] as const).map(
                  (k) =>
                    html`<label
                      >${k}<input
                        aria-label=${`${r.memberId} ${k}`}
                        .value=${live(r[k])}
                        @input=${(e: Event) => {
                          r[k] = (e.target as HTMLInputElement).value;
                          draft.dirty = true;
                        }}
                    /></label>`,
                )}<label
                  >Articulation<select
                    aria-label=${`${r.memberId} articulation`}
                    .value=${live(r.articulation)}
                    @change=${(e: Event) => {
                      r.articulation = (e.target as HTMLSelectElement).value;
                      draft.dirty = true;
                    }}
                  >
                    ${["inherit", "normal", "staccato", "sustain", "muted", "ghost"].map((a) => html`<option>${a}</option>`)}
                  </select></label
                >
              </div>
            </fieldset>`,
        )}<button>Save member performance</button
        ><button
          type="button"
          @click=${() => {
            drafts.delete(key);
            c.notify();
          }}
        >
          Reload saved performance
        </button>
        <p role="status">
          ${draft.dirty && draft.revision !== c.current!.revision ? "Song changed. Your member draft is preserved; reload or resolve before saving." : "Offsets and durations use exact quarter notes. Gain multiplies event accent; articulation inherits unless overridden."}
        </p>
      </form>
    </details>`;
  };
}
