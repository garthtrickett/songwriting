import { html } from "lit-html";
import type { Controller } from "./controller.ts";
import { actions } from "./actions.ts";
export function songLibrary(c: Controller) {
  const handle = actions(c);
  return html`
    <aside class="library">
      <div class="eyebrow">BROWSER</div>
      <div class="library-heading">
        <h2>Songs</h2>
        <button
          class="icon"
          aria-label="New song"
          @click=${handle(() => c.create())}
        >
          +
        </button>
      </div>
      <div class="song-list">
        ${c.songs.map(
          (e) =>
            html`<button
              class="song-link ${c.current?.id === e.id ? "selected" : ""}"
              @click=${handle(() => c.open(e.id))}
            >
              <span>♮</span>
              <div>
                ${e.song!.title}<small
                  >${Object.keys(e.song!.tables.patterns).length} patterns ·
                  ${e.song!.mode}</small
                >
              </div>
            </button>`,
        )}
      </div>
      <label class="import-button"
        >↥ Import song<input
          type="file"
          accept=".json,.song.json"
          @change=${(e: Event) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) void handle(async () => c.import(await f.text(), true))();
            (e.target as HTMLInputElement).value = "";
          }}
      /></label>
      <details>
        <summary>Recently deleted · ${c.deletedSongs.length}</summary>
        ${c.deletedSongs.map(
          (e) =>
            html`<button
              class="song-link"
              @click=${handle(async () => {
                const r = await c.mutate({
                  songId: e.id,
                  expectedRevision: e.revision,
                  operationId: crypto.randomUUID(),
                  label: "Restore song",
                  command: {
                    kind: "undo",
                    targetId: e.history.at(-1)!.operationId,
                  },
                });
                if (r.ok) await c.open(e.id);
                return r;
              })}
            >
              Restore ${e.history.at(-1)?.deletedSong?.title ?? e.id}
            </button>`,
        )}
      </details>
    </aside>
  `;
}
