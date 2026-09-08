import { html, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import type { Controller } from "./controller.ts";
import { pitchLabel, type Pitch, type Pattern } from "../song/model.ts";
import { noteKey, snapTime, type EditableNote } from "../song/note-edit.ts";
import type { Sound } from "../song/timeline.ts";
import { bars } from "../song/timeline.ts";
import { value, format, add, sub, cmp, time, type Time } from "../song/time.ts";
interface Grid {
  width: number;
  rows: Pitch[];
  notes: EditableNote[];
  ghosts: Sound[];
  zoom: number;
  origin: Time;
  length: Time;
  pattern: Pattern;
  gridLines: Time[];
  gridStep: Time;
  snap: Time;
  snapping: boolean;
  draw: boolean;
  selected: Set<string>;
  barList: ReturnType<typeof bars>;
}
interface Gestures {
  pointerStart: (e: PointerEvent, n: EditableNote) => void;
  pointerMove: (e: PointerEvent) => void;
  finishGesture: (cancel?: boolean) => void;
  selection: (n: EditableNote, extend?: boolean) => void;
  createAt: (at: Time, pitch: Pitch) => unknown;
}
export function noteGrid(c: Controller, grid: Grid, gestures: Gestures) {
  const s = c.song!;
  const {
    width,
    rows,
    notes,
    ghosts,
    zoom,
    origin,
    length,
    pattern,
    gridLines,
    gridStep,
    snap,
    snapping,
    draw,
    selected,
    barList,
  } = grid;
  const { pointerStart, pointerMove, finishGesture, selection, createAt } =
    gestures;
  const rowIndex = (p: Pitch) =>
    rows.findIndex(
      (r) =>
        r.degree === p.degree &&
        r.octave === p.octave &&
        r.alteration === p.alteration,
    );
  return html` <div
    class="degree-scroll"
    tabindex="0"
    aria-label="Relative note editor"
  >
    <div
      class="degree-canvas"
      style=${`width:${width + 64}px;height:${rows.length * 24 + 28}px`}
    >
      <div class="degree-ruler">
        <span>1–7</span>
        <div style=${`width:${width}px`}>
          ${gridLines
            .filter(
              (_, i) =>
                i % Math.max(1, Math.ceil(42 / (value(gridStep) * zoom))) === 0,
            )
            .map(
              (at) =>
                html`<span style=${`left:${value(at) * zoom}px`}
                  >${format(add(origin, at))}q</span
                >`,
            )}
        </div>
      </div>
      ${rows.map(
        (r, i) =>
          html`<div class="degree-row" style=${`top:${28 + i * 24}px`}>
            <span class="degree-label">${pitchLabel(r)}</span>
            <div
              class="degree-cell"
              style=${`width:${width}px`}
              @pointerdown=${(e: PointerEvent) => {
                if (!draw || !e.isPrimary || e.button !== 0) return;
                e.preventDefault();
                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                const at = snapTime(
                  time(Math.round((e.clientX - rect.left) * 100), zoom * 100),
                  snapping ? snap : [1, 960],
                );
                if (cmp(at, pattern.length) >= 0) {
                  c.error =
                    "New notes must start inside the pattern cycle. Extend its length in Selection first.";
                  c.notify();
                  return;
                }
                void createAt(at, r);
              }}
            ></div>
          </div>`,
      )}
      <div class="degree-guides" style=${`left:64px;width:${width}px`}>
        ${gridLines.map(
          (at) => html`<i style=${`left:${value(at) * zoom}px`}></i>`,
        )}${barList
          .filter(
            (b) =>
              cmp(b.start, origin) >= 0 &&
              cmp(b.start, add(origin, length)) < 0,
          )
          .map(
            (b) =>
              html`<i
                class="bar-guide"
                title=${`Bar ${b.index + 1} · ${b.numerator}/${b.denominator} · ${b.groups.join("+")}`}
                style=${`left:${value(sub(b.start, origin)) * zoom}px`}
              ></i>`,
          )}${barList.flatMap((b) => {
          let at = b.start;
          return b.groups.slice(0, -1).map((group) => {
            at = add(at, time(group * 4, b.denominator));
            const groupAt = at;
            return cmp(groupAt, origin) >= 0 &&
              cmp(groupAt, add(origin, length)) < 0
              ? html`<i
                  class="group-guide"
                  style=${`left:${value(sub(groupAt, origin)) * zoom}px`}
                ></i>`
              : nothing;
          });
        })}<i
          class="cycle-guide"
          style=${`left:${value(pattern.length) * zoom}px`}
          title="Pattern cycle end · releases may continue"
        ></i>
      </div>
      ${ghosts.slice(0, 512).map((n) => {
        const row = rowIndex(n.pitch!);
        return row < 0
          ? nothing
          : html`<button
              class="degree-note ghost"
              title=${`Edit ${s.tables.voices[n.voiceId]!.name} · ${pitchLabel(n.pitch!)}`}
              style=${`left:${64 + value(sub(n.start, origin)) * zoom}px;top:${28 + row * 24}px;width:${Math.max(8, value(n.duration) * zoom - 2)}px`}
              @click=${() =>
                c.select(
                  { table: "events", id: n.eventId },
                  {
                    occurrenceId: n.occurrenceId,
                    appearanceId: n.appearanceId,
                    origin: n.cycleOrigin,
                  },
                )}
            >
              ${pitchLabel(n.pitch!)}
            </button>`;
      })}
      ${repeat(
        notes,
        noteKey,
        (n) =>
          html`<button
            class="degree-note ${selected.has(noteKey(n))
              ? "selected"
              : ""} ${n.memberId ? "chord-member" : ""}"
            data-note-key=${noteKey(n)}
            aria-label=${`${pitchLabel(n.pitch)} at ${format(n.start)} for ${format(n.duration)}${n.memberId ? " chord member " + n.memberId : ""}`}
            aria-pressed=${selected.has(noteKey(n))}
            title=${`${s.tables.events[n.eventId]!.name} · ${pitchLabel(n.pitch)} · ${format(n.start)} → ${format(add(n.start, n.duration))}`}
            style=${`left:${64 + value(n.start) * zoom}px;top:${28 + rowIndex(n.pitch) * 24}px;width:${Math.max(8, value(n.duration) * zoom - 2)}px`}
            @pointerdown=${(e: PointerEvent) => pointerStart(e, n)}
            @pointermove=${pointerMove}
            @pointerup=${() => finishGesture()}
            @pointercancel=${() => finishGesture(true)}
            @click=${(e: MouseEvent) => {
              if (e.detail === 0)
                selection(n, e.shiftKey || e.metaKey || e.ctrlKey);
            }}
          >
            ${pitchLabel(n.pitch)}<span
              class="note-resize"
              aria-hidden="true"
            ></span>
          </button>`,
      )}
      <div class="degree-playhead"></div>
    </div>
  </div>`;
}
