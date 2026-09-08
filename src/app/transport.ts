import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import { actions } from "./actions.ts";
import { historyStacks } from "../song/history.ts";
import { executeTool } from "../agent/tools.ts";
import { format, parse } from "../song/time.ts";
export function transport(c: Controller) {
  const song = c.song,
    handle = actions(c);
  return song
    ? html`
        <div class="transport">
          <button
            ?disabled=${!historyStacks(c.current!.history).undo.length}
            @click=${handle(() => c.historyAction("undo"))}
          >
            Undo</button
          ><button
            ?disabled=${!historyStacks(c.current!.history).redo.length}
            @click=${handle(() => c.historyAction("redo"))}
          >
            Redo
          </button>
          <button
            class="play"
            aria-label=${c.audio.playing ? "Stop" : "Play"}
            @click=${handle(() =>
              executeTool(c, "transport", {
                action: c.audio.playing ? "stop" : "play",
              }),
            )}
          >
            ${c.audio.playing ? "■ Stop" : "▶ Play"}
          </button>
          <label
            ><input
              aria-label="Tempo"
              type="number"
              min="10"
              max="600"
              .value=${String(song.tempo.bpm)}
              @change=${(e: Event) =>
                void handle(() =>
                  c.edit(
                    {
                      kind: "edit",
                      changes: [
                        {
                          table: "meta",
                          id: "tempo",
                          value: {
                            ...song.tempo,
                            bpm: Number((e.target as HTMLInputElement).value),
                          },
                        },
                      ],
                    },
                    "Change tempo",
                  ),
                )()}
            />
            BPM</label
          >
          <label
            >Pulse
            <input
              aria-label="Tempo beat unit"
              class="short"
              .value=${format(song.tempo.beatUnit)}
              @change=${(e: Event) =>
                void handle(() =>
                  c.edit(
                    {
                      kind: "edit",
                      changes: [
                        {
                          table: "meta",
                          id: "tempo",
                          value: {
                            ...song.tempo,
                            beatUnit: parse(
                              (e.target as HTMLInputElement).value,
                            ),
                          },
                        },
                      ],
                    },
                    "Change beat unit",
                  ),
                )()}
          /></label>
          <label
            >Hear in
            <select
              aria-label="Playback key"
              .value=${String(c.audio.tonic)}
              @change=${(e: Event) =>
                void handle(() =>
                  executeTool(c, "transport", {
                    action: "settings",
                    tonic: Number((e.target as HTMLSelectElement).value),
                  }),
                )()}
            >
              ${[
                "C",
                "C♯",
                "D",
                "E♭",
                "E",
                "F",
                "F♯",
                "G",
                "A♭",
                "A",
                "B♭",
                "B",
              ].map(
                (name, i) => html`<option value=${48 + i}>${name}</option>`,
              )}
            </select></label
          >
          <label class="check"
            ><input
              type="checkbox"
              .checked=${c.audio.metronome}
              @change=${(e: Event) =>
                void handle(() =>
                  executeTool(c, "transport", {
                    action: "settings",
                    metronome: (e.target as HTMLInputElement).checked,
                  }),
                )()}
            />
            Click</label
          >
          <label
            >Seek
            <input
              aria-label="Seek position"
              class="short"
              type="number"
              min="0"
              value="0"
              @change=${(e: Event) =>
                void handle(() =>
                  executeTool(c, "transport", {
                    action: "seek",
                    position: Number((e.target as HTMLInputElement).value),
                  }),
                )()} /></label
          ><span class="transport-note">RELATIVE PITCH · MAJOR REFERENCE</span>
        </div>
      `
    : nothing;
}
