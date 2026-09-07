import { html } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { Controller } from "./controller.ts";
import type { Lyric } from "../song/model.ts";

export function lyricEditor(c: Controller) {
  const drafts = new Map<
    string,
    { text: string; revision: number; dirty: boolean }
  >();
  return (lyric: Lyric) => {
    const key = `${c.song!.id}/${lyric.id}`;
    let draft = drafts.get(key);
    if (!draft || !draft.dirty) {
      draft = { text: lyric.text, revision: c.current!.revision, dirty: false };
      drafts.set(key, draft);
    }
    const d = draft;
    return html`<form
      @submit=${async (event: SubmitEvent) => {
        event.preventDefault();
        const r = await c.mutate({
          songId: c.song!.id,
          expectedRevision: d.revision,
          operationId: crypto.randomUUID(),
          label: "Edit lyrics",
          command: {
            kind: "edit",
            changes: [
              {
                table: "lyrics",
                id: lyric.id,
                value: { ...lyric, text: d.text },
              },
            ],
          },
        });
        if (r.ok) d.dirty = false;
        c.notify();
      }}
    >
      <label
        >Words<textarea
          aria-label="Lyric text"
          .value=${live(d.text)}
          @input=${(e: Event) => {
        d.text = (e.target as HTMLTextAreaElement).value;
        d.dirty = true;
      }}
        ></textarea>
      </label>
      <button class="primary">Save lyrics</button>
      <button
        type="button"
        @click=${() => {
        drafts.delete(key);
        c.notify();
      }}
      >
        Reload saved lyrics
      </button>
      <p class="muted" role="status">
        ${d.dirty && d.revision !== c.current!.revision ? "Song changed. Your draft is preserved; copy it before reloading saved lyrics." : "Words are saved when you choose Save lyrics."}
      </p>
    </form>`;
  };
}
