import { html } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { Controller } from "./controller.ts";
import type { Polyrhythm } from "../song/model.ts";
import { format, parse } from "../song/time.ts";

/** Scope and lane references must be saved together to remain a valid graph. */
export function polyrhythmEditor(c: Controller) {
  type Draft = {
    value: Polyrhythm;
    start: string;
    duration: string;
    revision: number;
    dirty: boolean;
  };
  const drafts = new Map<string, Draft>();
  return (p: Polyrhythm) => {
    const key = `${c.song!.id}/${p.id}`;
    let d = drafts.get(key);
    if (!d || !d.dirty) {
      d = {
        value: structuredClone(p),
        start: format(p.start),
        duration: format(p.duration),
        revision: c.current!.revision,
        dirty: false,
      };
      drafts.set(key, d);
    }
    const draft = d;
    const edit = (fn: () => void) => {
      fn();
      draft.dirty = true;
      c.notify();
    };
    return html`<form
      @submit=${async (ev: SubmitEvent) => {
        ev.preventDefault();
        try {
          const r = await c.mutate({
            songId: c.song!.id,
            expectedRevision: draft.revision,
            operationId: crypto.randomUUID(),
            label: "Edit polyrhythm grid",
            command: {
              kind: "edit",
              changes: [
                {
                  table: "polyrhythms",
                  id: p.id,
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
        } catch (e) {
          c.error = String(e);
        }
        c.notify();
      }}
    >
      <label
        >Grid scope<select
          aria-label="Grid scope"
          .value=${live(draft.value.sectionId ?? "")}
          @change=${(ev: Event) =>
        edit(() => {
          draft.value.sectionId =
            (ev.target as HTMLSelectElement).value || null;
        })}
        >
          <option value="">Global · song time</option>
          ${Object.values(c.song!.tables.sections).map((s) => html`<option value=${s.id}>${s.name}</option>`)}
        </select></label
      >
      <label
        >Grid start<input
          aria-label="Grid start"
          .value=${live(draft.start)}
          @input=${(ev: Event) => {
        draft.start = (ev.target as HTMLInputElement).value;
        draft.dirty = true;
      }}
      /></label>
      <label
        >Grid duration<input
          aria-label="Grid duration"
          .value=${live(draft.duration)}
          @input=${(ev: Event) => {
        draft.duration = (ev.target as HTMLInputElement).value;
        draft.dirty = true;
      }}
      /></label>
      ${draft.value.lanes.map(
        (lane, i) =>
          html`<fieldset>
            <legend>Grid lane ${i + 1}</legend>
            <label
              >Placement<select
                aria-label=${`Grid lane ${i + 1} placement`}
                .value=${live(lane.occurrenceId)}
                @change=${(ev: Event) =>
                  edit(() => {
                    lane.occurrenceId = (ev.target as HTMLSelectElement).value;
                  })}
              >
                ${Object.values(c.song!.tables.occurrences).map((o) => html`<option value=${o.id}>${o.name} · ${o.sectionId ?? "global"}</option>`)}
              </select></label
            ><label
              >Divisions<input
                aria-label=${`Grid lane ${i + 1} divisions`}
                type="number"
                min="1"
                max="64"
                .value=${live(String(lane.divisions))}
                @input=${(ev: Event) => {
                  lane.divisions = Number(
                    (ev.target as HTMLInputElement).value,
                  );
                  draft.dirty = true;
                }} /></label
            ><button
              type="button"
              ?disabled=${draft.value.lanes.length <= 2}
              @click=${() =>
                edit(() => {
                  draft.value.lanes.splice(i, 1);
                })}
            >
              Remove grid lane ${i + 1}
            </button>
          </fieldset>`,
      )}
      <button
        type="button"
        ?disabled=${draft.value.lanes.length >= 8}
        @click=${() =>
        edit(() => {
          draft.value.lanes.push({
            occurrenceId: Object.keys(c.song!.tables.occurrences)[0] ?? "",
            divisions: 2,
          });
        })}
      >
        Add grid lane
      </button>
      <button class="primary">Save grid</button
      ><button
        type="button"
        @click=${() => {
        drafts.delete(key);
        c.notify();
      }}
      >
        Reload saved grid
      </button>
      <p class="muted" role="status">
        ${draft.dirty && draft.revision !== c.current!.revision ? "Song changed. Your grid draft is preserved; reload saved grid before editing again." : "Save scope and lane changes together. Lanes must use distinct voices in the chosen scope. This edits the declared grid only."}
      </p>
    </form>`;
  };
}
