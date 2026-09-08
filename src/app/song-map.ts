import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import type { Song } from "../song/model.ts";
import { pitchLabel } from "../song/model.ts";
import { placements, sectionSpans } from "../song/arrangement.ts";
import {
  sounds,
  bars,
  cycleStarts,
  restSpans,
  songEnd,
  secondsPerQuarter,
} from "../song/timeline.ts";
import { add, sub, value, format } from "../song/time.ts";
import { annotationLanes } from "./annotations.ts";

import { takePlacements } from "../song/media.ts";
const extents = new WeakMap<Song, number>();
export function songExtent(song: Song): number {
  const cached = extents.get(song);
  if (cached !== undefined) return cached;
  let end = Math.max(8, value(songEnd(song)));
  for (const n of sounds(song))
    end = Math.max(end, value(add(n.start, n.duration)));
  for (const t of takePlacements(song))
    end = Math.max(end, value(t.at) + t.duration / secondsPerQuarter(song));
  extents.set(song, end);
  return end;
}
// Geometry depends on the immutable song, not drawer, task or selection updates.
export function songMap(c: Controller) {
  let previous: Song | null = null;
  let score: ReturnType<typeof sounds> = [],
    barList: ReturnType<typeof bars> = [];
  let placed: ReturnType<typeof placements> = [],
    rests: ReturnType<typeof restSpans> = [];
  const draw = (width: number) => {
    const song = c.song!;
    const px = c.zoom;
    if (song !== previous) {
      score = sounds(song);
      barList = bars(song);
      placed = placements(song);
      rests = restSpans(song);
      previous = song;
    }
    return html`
      <div class="score-scroll" tabindex="0" aria-label="Song timeline">
        <div class="score" style=${`width:${width + 140}px`}>
          <div class="section-ruler annotation-lane">
            <span class="lane-name">SECTIONS</span>
            <div style=${`width:${width}px;position:relative`}>
              ${sectionSpans(song).map(
                (a) =>
                  html`<button
                    data-section-appearance=${a.id}
                    class="annotation section-region ${c.selection?.id === a.id
                      ? "chosen"
                      : ""}"
                    style=${`left:${value(a.start) * px}px;width:${value(a.length) * px}px`}
                    @click=${() => c.select({ table: "arrangement", id: a.id })}
                  >
                    ${a.name}
                  </button>`,
              )}
            </div>
          </div>
          <div class="ruler">
            <span class="lane-name">METER</span>
            <div class="ruler-body" style=${`width:${width}px`}>
              ${barList.map(
                (b) =>
                  html`<button
                    style=${`left:${value(b.start) * px}px;width:${value(b.length) * px}px`}
                    @click=${() => {
                      c.select({ table: "bars", id: b.id });
                    }}
                  >
                    <b>${b.index + 1}</b>
                    ${b.numerator}/${b.denominator}<small
                      >${b.groups.join("+")}</small
                    >
                  </button>`,
              )}
            </div>
          </div>
          ${annotationLanes(c, width)}
          ${Object.values(song.tables.voices).map((voice, i) => {
            const part = song.tables.parts[voice.partId]!;
            return html`<div
              class="lane color-${Object.keys(song.tables.parts).indexOf(
                part.id,
              ) % 4} ${part.muted ? "muted-part" : ""}"
            >
              <button
                class="lane-name"
                @click=${() => {
                  c.select({ table: "voices", id: voice.id });
                }}
              >
                <b>${part.name}</b><small>${voice.name}</small>
              </button>
              <div
                class="lane-body"
                style=${`width:${width}px;background-size:${px}px 100%`}
              >
                ${placed
                  .filter((o) => o.voiceId === voice.id)
                  .map(
                    (o) =>
                      html`<button
                        data-occurrence-id=${o.id}
                        data-appearance-id=${o.appearanceId ?? ""}
                        class="occurrence ${c.selection?.table ===
                          "occurrences" &&
                        c.selection.id === o.id &&
                        (!c.selectionPlacement ||
                          c.selectionPlacement.appearanceId === o.appearanceId)
                          ? "chosen"
                          : ""}"
                        style=${`left:${value(o.start) * px}px;width:${value(o.span) * px}px`}
                        @click=${() => {
                          c.select(
                            { table: "occurrences", id: o.id },
                            {
                              occurrenceId: o.id,
                              appearanceId: o.appearanceId,
                              origin: sub(o.start, o.phase),
                            },
                          );
                        }}
                      >
                        ${song.tables.patterns[o.patternId]!.name}
                        <span
                          >${format(song.tables.patterns[o.patternId]!.length)}
                          q · ${o.sectionId ? "section" : "global"} ·
                          ${o.tails}</span
                        >
                      </button>`,
                  )}
                ${placed
                  .filter((o) => o.voiceId === voice.id)
                  .flatMap((o) => cycleStarts(song, o))
                  .map(
                    (at) =>
                      html`<span
                        class="cycle-edge"
                        style=${`left:${value(at) * px}px`}
                        title=${`Cycle begins at ${format(at)} quarter notes`}
                      ></span>`,
                  )}
                ${rests
                  .filter((r) => r.voiceId === voice.id)
                  .map(
                    (r) =>
                      html`<button
                        class="rest-block"
                        style=${`left:${value(r.start) * px}px;width:${Math.max(10, value(r.duration) * px)}px`}
                        title="Rest"
                        @click=${() => {
                          c.select({ table: "events", id: r.eventId });
                        }}
                      >
                        𝄽
                      </button>`,
                  )}
                ${score
                  .filter((n) => n.voiceId === voice.id)
                  .map(
                    (n) =>
                      html`<button
                        data-event-id=${n.eventId}
                        data-appearance-id=${n.appearanceId ?? ""}
                        data-cycle-origin=${format(n.cycleOrigin)}
                        class="note-block ${c.selection?.id === n.eventId
                          ? "chosen"
                          : ""}"
                        style=${`left:${value(n.start) * px}px;width:${Math.max(5, value(n.duration) * px - 2)}px;top:${n.pitch ? 37 + (7 - n.pitch.degree) * 3 : 46}px`}
                        title=${`${n.pitch ? pitchLabel(n.pitch) : n.drum} · ${format(n.start)} → ${format(add(n.start, n.duration))}`}
                        @click=${() => {
                          c.select(
                            { table: "events", id: n.eventId },
                            {
                              occurrenceId: n.occurrenceId,
                              appearanceId: n.appearanceId,
                              origin: n.cycleOrigin,
                            },
                          );
                        }}
                      >
                        ${n.pitch
                          ? pitchLabel(n.pitch)
                          : n.drum === "kick"
                            ? "●"
                            : n.drum === "snare"
                              ? "×"
                              : "·"}
                      </button>`,
                  )}
              </div>
            </div>`;
          })}
          ${Object.keys(song.tables.voices).length === 0
            ? html`<div class="score-empty">
                Build a part, give it a voice, then place a pattern.<br /><small
                  >Open Objects to add music, or work with your agent.</small
                >
              </div>`
            : nothing}
          <div class="marker-lane">
            <span class="lane-name">MARKERS</span>
            <div style=${`width:${width}px;position:relative`}>
              ${Object.values(song.tables.markers).map(
                (m) =>
                  html`<button
                    style=${`left:${value(m.at) * px}px`}
                    @click=${() => {
                      c.select({ table: "markers", id: m.id });
                    }}
                  >
                    ⚑ ${m.name}
                  </button>`,
              )}
            </div>
          </div>
          <div id="playhead" class="playhead"></div>
        </div>
      </div>
    `;
  };
  let highlighted: HTMLElement[] = [];
  return {
    render: draw,
    select: (root: HTMLElement) => {
      for (const node of root.querySelectorAll(".score .chosen"))
        node.classList.remove("chosen");
      highlighted = [];
      const sel = c.selection;
      if (!sel) return;
      const attr =
        sel.table === "events"
          ? "data-event-id"
          : sel.table === "occurrences"
            ? "data-occurrence-id"
            : sel.table === "arrangement"
              ? "data-section-appearance"
              : null;
      if (!attr) return;
      highlighted = [
        ...root.querySelectorAll<HTMLElement>(
          `[${attr}="${CSS.escape(sel.id)}"]`,
        ),
      ].filter((node) => {
        const context = c.selectionPlacement;
        return (
          !context ||
          (node.dataset.appearanceId === (context.appearanceId ?? "") &&
            (sel.table !== "events" ||
              node.dataset.cycleOrigin === format(context.origin)))
        );
      });
      for (const node of highlighted) node.classList.add("chosen");
    },
  };
}
