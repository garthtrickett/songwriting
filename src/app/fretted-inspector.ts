import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { Controller } from "./controller.ts";
import { TECHNIQUES, type Fretted, type Fingering } from "../song/model.ts";
import { TUNINGS } from "../song/fretted.ts";
export function frettedEditor(c: Controller) {
  const drafts = new Map<
    string,
    { revision: number; dirty: boolean; fields: Record<string, string> }
  >();
  return (table: "fretted" | "fingerings", entity: Fretted | Fingering) => {
    const key = `${c.song!.id}/${table}/${entity.id}`;
    let d = drafts.get(key);
    if (!d || !d.dirty) {
      d = {
        revision: c.current!.revision,
        dirty: false,
        fields: Object.fromEntries(
          Object.entries(entity).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(", ") : String(v ?? ""),
          ]),
        ),
      };
      drafts.set(key, d);
    }
    const draft = d;
    const set = (k: string, v: string) => {
      draft.fields[k] = v;
      draft.dirty = true;
    };
    const input = (k: string, label: string) =>
      html`<label
        >${label}<input
          aria-label=${label}
          .value=${live(draft.fields[k] ?? "")}
          @input=${(e: Event) => set(k, (e.target as HTMLInputElement).value)}
      /></label>`;
    const select = (
      k: string,
      label: string,
      items: { id: string; name: string }[],
    ) =>
      html`<label
        >${label}<select
          aria-label=${label}
          .value=${live(draft.fields[k] ?? "")}
          @change=${(e: Event) => set(k, (e.target as HTMLSelectElement).value)}
        >
          ${items.map((i) => html`<option value=${i.id}>${i.name}</option>`)}
        </select></label
      >`;
    return html`<form
      @submit=${async (e: SubmitEvent) => {
        e.preventDefault();
        try {
          const f = draft.fields;
          const value =
            table === "fretted"
              ? {
                  id: entity.id,
                  name: f.name!,
                  partId: f.partId!,
                  tonic: Number(f.tonic),
                  tuning: f.tuning!.split(",").map((n) => Number(n.trim())),
                  capo: Number(f.capo),
                  maxFret: Number(f.maxFret),
                  handSpan: Number(f.handSpan),
                }
              : {
                  id: entity.id,
                  name: f.name!,
                  arrangementId: f.arrangementId!,
                  occurrenceId: f.occurrenceId!,
                  eventId: f.eventId!,
                  memberId: f.memberId || null,
                  string: Number(f.string),
                  fret: Number(f.fret),
                  technique: f.technique,
                  fromId: f.fromId || null,
                };
          const r = await c.mutate({
            songId: c.song!.id,
            expectedRevision: draft.revision,
            operationId: crypto.randomUUID(),
            label: `Edit ${table}`,
            command: {
              kind: "edit",
              changes: [{ table, id: entity.id, value }],
            },
          });
          if (r.ok) draft.dirty = false;
        } catch (e) {
          c.error = String(e);
        }
        c.notify();
      }}
    >
      <div class="field-grid">
        ${input("name", "Arrangement or fingering name")}${
          table === "fretted"
            ? html`
                ${select(
        "partId",
        "Fretted part",
        Object.values(c.song!.tables.parts).filter(
          (p) => p.instrument !== "drums",
        ),
      )}
                <label
                  >Tuning preset<select
                    aria-label="Tuning preset"
                    @change=${(e: Event) => {
        const name = (e.target as HTMLSelectElement).value;
        const tuning = TUNINGS[name as keyof typeof TUNINGS];
        if (tuning) {
          set("tuning", tuning.join(", "));
          c.notify();
        }
      }}
                  >
                    <option value="">Custom</option>
                    ${Object.keys(TUNINGS).map((name) => html`<option>${name}</option>`)}
                  </select></label
                >
                ${input("tuning", "Open strings · MIDI, string 1 first")}${input("tonic", "Arrangement tonic · MIDI")}${input("capo", "Capo")}${input("maxFret", "Physical last fret")}${input("handSpan", "Preferred hand span")}
              `
            : html`
                ${select("arrangementId", "Fingering arrangement", Object.values(c.song!.tables.fretted))}${input("occurrenceId", "Fingering placement ID")}${input("eventId", "Fingering event ID")}${input("memberId", "Fingering member ID · blank for note")}${input("string", "String number")}${input("fret", "Fret above capo")}${select(
        "technique",
        "Technique",
        TECHNIQUES.map((id) => ({ id, name: id })),
      )}${select("fromId", "Technique source", [{ id: "", name: "None" }, ...Object.values(c.song!.tables.fingerings).filter((f) => f.id !== entity.id)])}
              `
        }
      </div>
      <button>
        ${table === "fretted" ? "Save fretted arrangement" : "Save fingering"}</button
      ><button
        type="button"
        @click=${() => {
          drafts.delete(key);
          c.notify();
        }}
      >
        Reload saved fingering settings</button
      >${draft.revision !== c.current!.revision ? html`<p role="alert">Song changed. Your draft is preserved; reload saved settings before applying a revised edit.</p>` : nothing}
    </form>`;
  };
}
