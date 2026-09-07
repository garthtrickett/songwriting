import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { Controller } from "./controller.ts";
import type { Take } from "../song/model.ts";
import { format, parse } from "../song/time.ts";
export function takeEditor(c: Controller) {
  const drafts = new Map<
    string,
    { revision: number; dirty: boolean; fields: Record<string, string> }
  >();
  return (take: Take) => {
    const key = `${c.song!.id}/${take.id}`;
    let d = drafts.get(key);
    if (!d || !d.dirty) {
      d = {
        revision: c.current!.revision,
        dirty: false,
        fields: Object.fromEntries(
          Object.entries(take).map(([k, v]) => [
            k,
            k === "start" ? format(take.start) : String(v ?? ""),
          ]),
        ),
      };
      drafts.set(key, d);
    }
    const draft = d,
      set = (k: string, v: string) => {
        draft.fields[k] = v;
        draft.dirty = true;
      };
    const field = (k: string, label: string) =>
      html`<label
        >${label}<input
          aria-label=${label}
          .value=${live(draft.fields[k] ?? "")}
          @input=${(e: Event) => set(k, (e.target as HTMLInputElement).value)}
      /></label>`;
    const choice = (
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
          const value: Take = {
            id: take.id,
            name: f.name!,
            assetId: f.assetId!,
            partId: f.partId!,
            sectionId: f.sectionId || null,
            start: parse(f.start!),
            offset: Number(f.offset),
            duration: Number(f.duration),
            gain: Number(f.gain),
            muted: f.muted === "true",
          };
          const r = await c.mutate({
            songId: c.song!.id,
            expectedRevision: draft.revision,
            operationId: crypto.randomUUID(),
            label: "Edit recorded take",
            command: {
              kind: "edit",
              changes: [{ table: "takes", id: take.id, value }],
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
        ${field("name", "Take name")}${choice("assetId", "Take audio asset", Object.values(c.song!.tables.assets))}${choice("partId", "Take part", Object.values(c.song!.tables.parts))}${choice("sectionId", "Take scope", [{ id: "", name: "Global" }, ...Object.values(c.song!.tables.sections)])}${field("start", "Take start · quarters")}${field("offset", "Source offset · seconds")}${field("duration", "Take duration · seconds")}${field("gain", "Take gain · 0 to 1")}${choice(
          "muted",
          "Take audibility",
          [
            { id: "false", name: "Audible" },
            { id: "true", name: "Muted alternative" },
          ],
        )}
      </div>
      <p>
        Recorded sound stays in its original key. Trims use seconds; tempo moves
        the start without stretching audio.
      </p>
      <button>Save take</button
      ><button
        type="button"
        @click=${() => {
          drafts.delete(key);
          c.notify();
        }}
      >
        Reload saved take</button
      >${draft.revision !== c.current!.revision ? html`<p role="alert">Song changed; your take draft is preserved. Reload and review before saving.</p>` : nothing}
    </form>`;
  };
}
