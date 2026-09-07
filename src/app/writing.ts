import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { Controller } from "./controller.ts";
import type { Change } from "../song/commands.ts";
import { recipes, writingChanges, writingExport } from "../agent/writing.ts";
export function writingPanel(c: Controller, usePrompt: (text: string) => void) {
  type Draft = {
    revision: number;
    dirty: boolean;
    fields: Record<string, string>;
  };
  const drafts = new Map<string, Draft>();
  let selected = "new";
  const draft = (key: string, fields: Record<string, string>) => {
    const id = `${c.song!.id}/${key}`;
    let d = drafts.get(id);
    if (!d || !d.dirty) {
      d = { revision: c.current!.revision, dirty: false, fields };
      drafts.set(id, d);
    }
    return d;
  };
  const field = (d: Draft, key: string, label: string, max: number) =>
    html`<label
      >${label}<textarea
        aria-label=${label}
        maxlength=${max}
        .value=${live(d.fields[key] ?? "")}
        @input=${(e: Event) => {
          d.fields[key] = (e.target as HTMLTextAreaElement).value;
          d.dirty = true;
        }}
      ></textarea>
    </label>`;
  const save = async (d: Draft, changes: Change[], label: string) => {
    const snapshot = JSON.stringify(d.fields);
    const r = await c.mutate({
      songId: c.song!.id,
      expectedRevision: d.revision,
      operationId: crypto.randomUUID(),
      label,
      command: { kind: "edit", changes },
    });
    if (r.ok) {
      d.revision = r.value.revision;
      d.dirty = JSON.stringify(d.fields) !== snapshot;
    }
    c.notify();
    return r;
  };
  const run = async (fn: () => Promise<unknown> | unknown) => {
    try {
      await fn();
    } catch (e) {
      c.error = String(e);
      c.notify();
    }
  };
  const warning = (d: Draft) =>
    html`<p role="status" class="muted">
      ${d.dirty && d.revision !== c.current!.revision ? "Song changed. Draft preserved; reload or copy it before reconciling." : "Saved guidance travels with this song. Running tasks keep their original snapshot."}
    </p>`;
  return () => {
    const s = c.song;
    if (!s) return nothing;
    const guidance = draft("guidance", { ...s.writing }),
      p = s.tables.prompts[selected];
    const prompt = draft(
      `prompt/${selected}`,
      p ? { name: p.name, text: p.text } : { name: "", text: "" },
    );
    return html`<details class="writing-guidance">
      <summary>Writing guidance and reusable prompts</summary>
      <form
        @submit=${(e: SubmitEvent) => {
        e.preventDefault();
        void save(
          guidance,
          [{ table: "meta", id: "writing", value: { ...guidance.fields } }],
          "Edit writing guidance",
        );
      }}
      >
        ${field(guidance, "instructions", "Project instructions", 8000)}${field(guidance, "preferences", "Songwriting preferences", 4000)}
        <button class="primary">Save writing guidance</button
        ><button
          type="button"
          @click=${() => {
          guidance.dirty = false;
          c.notify();
        }}
        >
          Reload saved guidance</button
        >${warning(guidance)}
      </form>
      <label
        >Reusable prompt<select
          aria-label="Reusable prompt"
          .value=${live(selected)}
          @change=${(e: Event) => {
        selected = (e.target as HTMLSelectElement).value;
        c.notify();
      }}
        >
          <option value="new">New prompt</option>
          ${Object.values(s.tables.prompts).map((p) => html`<option value=${p.id}>${p.name}</option>`)}
        </select></label
      >
      <form
        @submit=${(e: SubmitEvent) => {
        e.preventDefault();
        const id = p?.id ?? crypto.randomUUID();
        void save(
          prompt,
          [{ table: "prompts", id, value: { id, ...prompt.fields } }],
          "Save reusable prompt",
        ).then((r) => {
          if (r.ok) {
            selected = id;
            c.notify();
          }
        });
      }}
      >
        ${field(prompt, "name", "Prompt name", 200)}${field(prompt, "text", "Prompt text", 8000)}
        <button class="primary">Save reusable prompt</button>
        <button
          type="button"
          @click=${() => usePrompt(prompt.fields.text ?? "")}
        >
          Use prompt in request
        </button>
        <button
          type="button"
          @click=${() => {
          prompt.dirty = false;
          c.notify();
        }}
        >
          Reload saved prompt
        </button>
        ${
          p
            ? html`<button
                type="button"
                @click=${() =>
                  void save(
                    prompt,
                    [{ table: "prompts", id: p.id, value: null }],
                    "Delete reusable prompt",
                  ).then((r) => {
                    if (r.ok) {
                      selected = "new";
                      c.notify();
                    }
                  })}
              >
                Delete reusable prompt
              </button>`
            : nothing
        }${warning(prompt)}
      </form>
      <label
        >Starting recipe<select
          aria-label="Starting recipe"
          @change=${(e: Event) => {
        const r = recipes.find(
          (r) => r.id === (e.target as HTMLSelectElement).value,
        );
        if (r) {
          prompt.fields = { name: r.name, text: r.text };
          prompt.dirty = true;
          c.notify();
        }
      }}
        >
          <option value="">Choose an editable starting point</option>
          ${recipes.map((r) => html`<option value=${r.id}>${r.name}</option>`)}
        </select></label
      >
      <details>
        <summary>Reuse guidance in another song</summary>
        <button
          @click=${() => {
          const blob = new Blob([writingExport(s)], {
              type: "application/json",
            }),
            url = URL.createObjectURL(blob),
            a = document.createElement("a");
          a.href = url;
          a.download = "writing.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
        >
          Export writing guidance
        </button>
        <label
          >Import writing guidance<input
            type="file"
            accept=".json"
            aria-label="Import writing guidance"
            @change=${(e: Event) => {
          const f = (e.target as HTMLInputElement).files?.[0],
            revision = c.current!.revision,
            songId = s.id;
          if (f)
            void run(async () => {
              const changes = writingChanges(s, await f.text());
              await c.mutate({
                songId,
                expectedRevision: revision,
                operationId: crypto.randomUUID(),
                label: "Import writing guidance",
                command: { kind: "edit", changes },
              });
            });
        }}
        /></label>
      </details>
    </details>`;
  };
}
