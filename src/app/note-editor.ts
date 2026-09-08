import { noteGrid } from "./note-grid.ts";
import { noteFields } from "./note-fields.ts";
import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import type { Change, Envelope, Mutation } from "../song/commands.ts";
import { noteEvent, pitchLabel, type Pitch, type Song } from "../song/model.ts";
import { placements } from "../song/arrangement.ts";
import { bars, sounds } from "../song/timeline.ts";
import {
  add,
  sub,
  mul,
  time,
  value,
  format,
  parse,
  cmp,
  ZERO,
  type Time,
} from "../song/time.ts";
import {
  editableNotes,
  noteKey,
  snapTime,
  shiftDegree,
  changeNotes,
  removeNotes,
  combineNotes,
  type EditableNote,
} from "../song/note-edit.ts";
import { vary } from "./entities.ts";

interface Gesture {
  pointer: number;
  element: HTMLElement;
  base: Envelope;
  notes: EditableNote[];
  x: number;
  y: number;
  dx: Time;
  degree: number;
  resize: boolean;
  moved: boolean;
  rows: Pitch[];
  row: number;
}

export function noteEditor(c: Controller) {
  let patternId = "",
    occurrenceId = "",
    selectionKey = "",
    songId = "";
  let selected = new Set<string>(),
    draw = false,
    snap: Time = [1, 2],
    snapping = true,
    zoom = 72,
    octave = 0;
  let gesture: Gesture | null = null,
    proposals = new Map<string, Mutation>(),
    message = "";
  let scroll: HTMLElement | null = null,
    origin: Time = ZERO;
  let visibleBefore = false,
    shownPattern = "",
    axisRows: Pitch[] = [];
  let previous: Song | null = null,
    allSounds: ReturnType<typeof sounds> = [],
    barList: ReturnType<typeof bars> = [];
  const run = async (fn: () => unknown) => {
    try {
      await fn();
    } catch (error) {
      message = String(error);
      c.notify();
    }
  };
  const commit = async (base: Envelope, changes: Change[], label: string) => {
    const mutation: Mutation = {
      songId: base.id,
      expectedRevision: base.revision,
      operationId: crypto.randomUUID(),
      label,
      command: { kind: "edit", changes },
    };
    const result = await c.mutate(mutation);
    if (result.ok) {
      message = "";
    } else {
      proposals.set(mutation.operationId, mutation);
      message =
        "Song changed or edit rejected. Your proposed edit is retained below.";
    }
    c.notify();
    return result;
  };
  const fields = noteFields(c, commit);
  const selection = (n: EditableNote, extend = false) => {
    const id = noteKey(n);
    if (extend) {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    } else if (!selected.has(id)) selected = new Set([id]);
    selectionKey = `events/${n.eventId}`;
    c.select({ table: "events", id: n.eventId }, c.selectionPlacement);
  };
  const selectedNotes = () =>
    c.song
      ? editableNotes(c.song, patternId).filter((n) => selected.has(noteKey(n)))
      : [];
  const move = (dx: Time, degree: number, resize = false) =>
    run(async () => {
      const base = c.current!;
      await commit(
        base,
        changeNotes(
          base.song!,
          selectedNotes().map((n) => ({
            ...n,
            ...(resize
              ? { duration: add(n.duration, dx) }
              : {
                  start: add(n.start, dx),
                  pitch: shiftDegree(n.pitch, degree),
                }),
          })),
        ),
        resize ? "Resize notes" : "Move notes",
      );
    });
  const finishGesture = (cancel = false) => {
    const g = gesture;
    if (!g) return;
    gesture = null;
    g.element.style.transform = "";
    g.element.style.width = "";
    if (g.element.hasPointerCapture(g.pointer))
      g.element.releasePointerCapture(g.pointer);
    if (!cancel && g.moved)
      void run(() =>
        commit(
          g.base,
          changeNotes(
            g.base.song!,
            g.notes.map((n) => ({
              ...n,
              ...(g.resize
                ? { duration: add(n.duration, g.dx) }
                : {
                    start: add(n.start, g.dx),
                    pitch: shiftDegree(n.pitch, g.degree),
                  }),
            })),
          ),
          g.resize ? "Resize notes" : "Move notes",
        ),
      );
    else c.notify();
  };
  const pointerStart = (e: PointerEvent, n: EditableNote) => {
    if (!e.isPrimary || e.button !== 0 || gesture) return;
    e.preventDefault();
    e.stopPropagation();
    selection(n, e.shiftKey || e.metaKey || e.ctrlKey);
    if (!selected.has(noteKey(n))) return;
    const element = e.currentTarget as HTMLElement;
    element.focus();
    element.setPointerCapture(e.pointerId);
    gesture = {
      pointer: e.pointerId,
      element,
      base: c.current!,
      notes: selectedNotes(),
      x: e.clientX,
      y: e.clientY,
      dx: ZERO,
      degree: 0,
      resize: (e.target as HTMLElement).classList.contains("note-resize"),
      moved: false,
      rows: axisRows,
      row: axisRows.findIndex(
        (r) =>
          r.degree === n.pitch.degree &&
          r.octave === n.pitch.octave &&
          r.alteration === n.pitch.alteration,
      ),
    };
  };
  const pointerMove = (e: PointerEvent) => {
    const g = gesture;
    if (!g || g.pointer !== e.pointerId) return;
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) < 4 && !g.moved) return;
    g.moved = true;
    g.dx = snapTime(
      time(Math.round(dx * 100), zoom * 100),
      snapping ? snap : [1, 960],
    );
    // Degree motion follows principal degree rows, independent of accidental spelling.
    const targetRow = Math.max(
      0,
      Math.min(g.rows.length - 1, g.row + Math.round(dy / 24)),
    );
    const from = g.rows[g.row]!,
      to = g.rows[targetRow]!;
    g.degree = (to.octave - from.octave) * 7 + to.degree - from.degree;
    const first = g.notes.find(
      (n) => noteKey(n) === g.element.dataset.noteKey,
    )!;
    if (g.resize)
      g.element.style.width = `${Math.max(6, value(add(first.duration, g.dx)) * zoom - 2)}px`;
    else
      g.element.style.transform = `translate(${value(g.dx) * zoom}px,${(targetRow - g.row) * 24}px)`;
  };
  const keydown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,textarea,select")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (gesture) finishGesture(true);
      else {
        selected.clear();
        c.notify();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      e.stopPropagation();
      selected = new Set(editableNotes(c.song!, patternId).map(noteKey));
      c.notify();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      void move(
        e.key === "ArrowLeft"
          ? mul(snap, [-1, 1])
          : e.key === "ArrowRight"
            ? snap
            : ZERO,
        e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0,
        e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight"),
      );
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      void run(() =>
        commit(
          c.current!,
          removeNotes(c.song!, selectedNotes()),
          "Delete selected notes",
        ),
      );
    }
  };
  const createAt = (start: Time, pitch: Pitch) =>
    run(async () => {
      const id = crypto.randomUUID();
      const event = {
        ...noteEvent(id, patternId),
        pitch,
        start,
        duration: snap,
      };
      const result = await commit(
        c.current!,
        [{ table: "events", id, value: event }],
        "Draw relative note",
      );
      if (result.ok) {
        selected = new Set([`${id}/`]);
        selectionKey = `events/${id}`;
        c.select({ table: "events", id }, c.selectionPlacement);
      }
    });
  const createPart = () =>
    run(async () => {
      const id = crypto.randomUUID(),
        partId = `${id}-part`,
        voiceId = `${id}-voice`,
        pid = `${id}-pattern`,
        oid = `${id}-placement`;
      const result = await commit(
        c.current!,
        [
          {
            table: "parts",
            id: partId,
            value: {
              id: partId,
              name: "Guitar",
              instrument: "guitar",
              volume: 0.6,
              muted: false,
            },
          },
          {
            table: "voices",
            id: voiceId,
            value: { id: voiceId, name: "Voice 1", partId },
          },
          {
            table: "patterns",
            id: pid,
            value: {
              id: pid,
              name: "New idea",
              sourceId: null,
              length: [4, 1],
              groups: [],
            },
          },
          {
            table: "occurrences",
            id: oid,
            value: {
              id: oid,
              name: "New idea",
              patternId: pid,
              voiceId,
              sectionId: null,
              start: [0, 1],
              span: [4, 1],
              phase: [0, 1],
              boundary: "continue",
              tails: "ring",
            },
          },
        ],
        "Create pitched part and pattern",
      );
      if (result.ok) c.select({ table: "occurrences", id: oid });
    });
  const makeVariation = () =>
    run(async () => {
      const base = c.current!,
        id = crypto.randomUUID();
      const changes = vary(base.song!, patternId, id);
      // A local placement is shared by section appearances. Keep that scope explicit;
      // Structure's section variation is the action for changing only one appearance.
      if (occurrenceId) {
        const o = base.song!.tables.occurrences[occurrenceId]!;
        changes.push({
          table: "occurrences",
          id: o.id,
          value: { ...o, patternId: id },
        });
      }
      const result = await commit(base, changes, "Make pattern variation");
      if (result.ok) {
        patternId = id;
        selected.clear();
        c.select({ table: "patterns", id });
      }
    });
  const render = () => {
    const s = c.song;
    if (!s) return nothing;
    if (songId !== s.id) {
      songId = s.id;
      patternId = "";
      occurrenceId = "";
      selected.clear();
      selectionKey = "";
    }
    if (previous !== s) {
      allSounds = sounds(s);
      barList = bars(s);
      previous = s;
    }
    const sel = c.selection,
      key = sel ? `${sel.table}/${sel.id}` : "";
    if (key !== selectionKey) {
      selectionKey = key;
      let pid = "";
      if (sel?.table === "events")
        pid = s.tables.events[sel.id]?.patternId ?? "";
      if (sel?.table === "patterns") pid = sel.id;
      if (sel?.table === "occurrences") {
        occurrenceId = sel.id;
        pid = s.tables.occurrences[sel.id]?.patternId ?? "";
      }
      if (sel?.table === "voices") {
        const o = Object.values(s.tables.occurrences).find(
          (o) => o.voiceId === sel.id,
        );
        if (o) {
          occurrenceId = o.id;
          pid = o.patternId;
        }
      }
      if (pid) {
        if (pid !== patternId) selected.clear();
        patternId = pid;
      }
      if (sel?.table === "events")
        selected = new Set(
          editableNotes(s, patternId)
            .filter((n) => n.eventId === sel.id)
            .map(noteKey),
        );
    }
    if (!s.tables.patterns[patternId])
      patternId = Object.keys(s.tables.patterns)[0] ?? "";
    if (!patternId)
      return html`<div class="editor-empty">
        <h2>Write in degrees</h2>
        <p>Add a pitched part and place your first 1–7 notes.</p>
        <button @click=${createPart}>Create guitar part</button>
      </div>`;
    const pattern = s.tables.patterns[patternId]!;
    const placed = placements(s).filter((o) => o.patternId === patternId);
    const context = c.selectionPlacement;
    const placement =
      placed.find(
        (o) =>
          o.id === context?.occurrenceId &&
          o.appearanceId === context.appearanceId,
      ) ??
      placed.find((o) => o.id === occurrenceId) ??
      placed[0];
    occurrenceId = placement?.id ?? "";
    origin =
      placement &&
      context?.occurrenceId === placement.id &&
      context.appearanceId === placement.appearanceId
        ? context.origin
        : placement
          ? sub(placement.start, placement.phase)
          : ZERO;
    const voice = placement ? s.tables.voices[placement.voiceId] : null,
      part = voice ? s.tables.parts[voice.partId] : null;
    const notes = editableNotes(s, patternId);
    const active = notes.filter((n) => selected.has(noteKey(n)));
    const length = notes.reduce(
      (a, n) =>
        cmp(add(n.start, n.duration), a) > 0 ? add(n.start, n.duration) : a,
      pattern.length,
    );
    const width = Math.max(600, value(length) * zoom + 32);
    const minOct = Math.min(octave - 1, ...notes.map((n) => n.pitch.octave)),
      maxOct = Math.max(octave + 1, ...notes.map((n) => n.pitch.octave));
    const rows: Pitch[] = [];
    for (let o = Math.min(5, maxOct); o >= Math.max(-5, minOct); o--)
      for (let degree = 7; degree >= 1; degree--) {
        const alterations = new Set([
          0,
          ...notes
            .filter((n) => n.pitch.degree === degree && n.pitch.octave === o)
            .map((n) => n.pitch.alteration),
        ]);
        for (const alteration of [...alterations].sort((a, b) => b - a))
          rows.push({ degree, alteration, octave: o });
      }
    axisRows = rows;
    const ghosts = allSounds.filter(
      (n) =>
        n.pitch &&
        n.voiceId !== voice?.id &&
        cmp(n.start, origin) >= 0 &&
        cmp(n.start, add(origin, length)) < 0,
    );
    const gridStep: Time = snapping ? snap : [1, 1];
    const subdivisions = Math.ceil(value(length) / value(gridStep));
    const gridLines =
      subdivisions <= 1024
        ? Array.from({ length: subdivisions + 1 }, (_, i) =>
            mul(gridStep, time(i)),
          )
        : [];
    return html`<div class="note-editor" @keydown=${keydown}>
      <div class="note-toolbar">
        <label
          >Pattern<select
            aria-label="Editor pattern"
            .value=${patternId}
            @change=${(e: Event) =>
              c.select({
                table: "patterns",
                id: (e.target as HTMLSelectElement).value,
              })}
          >
            ${Object.values(s.tables.patterns).map(
              (p) => html`<option value=${p.id}>${p.name}</option>`,
            )}
          </select></label
        >
        <span class="note-scope"
          >${part?.name ?? "Unplaced"} / ${voice?.name ?? "source pattern"} ·
          ${placement?.appearanceId
            ? s.tables.arrangement[placement.appearanceId]?.name
            : "Global"}
          · song ${format(origin)} q</span
        >
        <button
          aria-pressed=${!draw}
          @click=${() => {
            draw = false;
            c.notify();
          }}
        >
          Select</button
        ><button
          aria-pressed=${draw}
          @click=${() => {
            draw = true;
            c.notify();
          }}
        >
          Draw
        </button>
        <label
          ><input
            type="checkbox"
            aria-label="Snap notes"
            .checked=${snapping}
            @change=${(e: Event) => {
              snapping = (e.target as HTMLInputElement).checked;
              c.notify();
            }}
          />Snap</label
        >
        <label
          >q<input
            aria-label="Note snap increment"
            .value=${format(snap)}
            @change=${(e: Event) =>
              void run(() => {
                const next = parse((e.target as HTMLInputElement).value);
                if (cmp(next, ZERO) <= 0)
                  throw new Error("Snap must be positive");
                snap = next;
                c.notify();
              })}
        /></label>
        <label
          >Zoom<input
            aria-label="Note editor zoom"
            type="range"
            min="24"
            max="144"
            step="1"
            .value=${String(zoom)}
            @input=${(e: Event) => {
              zoom = Number((e.target as HTMLInputElement).value);
              c.notify();
            }}
        /></label>
        <label
          >Register<input
            aria-label="Editor register"
            type="number"
            min="-4"
            max="4"
            .value=${String(octave)}
            @change=${(e: Event) => {
              octave = Math.max(
                -4,
                Math.min(4, Number((e.target as HTMLInputElement).value) || 0),
              );
              c.notify();
            }}
        /></label>
      </div>
      <div class="note-context">
        <span
          >Editing source · ${placed.length} arranged
          use${placed.length === 1 ? "" : "s"}${placement?.sectionId
            ? " · shared section placement"
            : ""}.
          ${active.some((n) => n.memberId)
            ? "Member pitch edits affect all uses of its chord."
            : ""}</span
        ><button @click=${makeVariation}>Make variation</button
        ><span class="muted"
          >For one section appearance, use Structure → Make section
          variation.</span
        >
      </div>
      ${part?.instrument === "drums"
        ? html`<p class="editor-empty">
            This is a drum part. Use Rhythm or select its named hits in the
            song; degrees edit pitched parts.
          </p>`
        : noteGrid(
            c,
            {
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
            },
            { pointerStart, pointerMove, finishGesture, selection, createAt },
          )}
      ${ghosts.length > 512
        ? html`<p class="muted">
            Showing 512 of ${ghosts.length} other-voice notes in this passage.
          </p>`
        : nothing}
      <div class="note-actions">
        <button
          @click=${() =>
            void createAt(ZERO, { degree: 1, alteration: 0, octave })}
          ?disabled=${part?.instrument === "drums"}
        >
          Add degree 1</button
        ><button
          ?disabled=${!active.length}
          @click=${() =>
            void run(() =>
              commit(
                c.current!,
                removeNotes(s, active),
                "Delete selected notes",
              ),
            )}
        >
          Delete notes</button
        ><button
          ?disabled=${!active.length || active.some((n) => n.memberId !== null)}
          @click=${() =>
            void run(() =>
              commit(
                c.current!,
                combineNotes(
                  s,
                  active,
                  crypto.randomUUID(),
                  crypto.randomUUID(),
                ),
                "Make chord from notes",
              ),
            )}
        >
          Make chord</button
        ><span
          >${active.length} selected · Shift-click: multiple · Arrows: move ·
          Shift ←/→: length ·
          ${snapping
            ? "snap " + format(snap) + "q"
            : "unsnapped · 1/960q resolution"}</span
        >
      </div>
      ${active.length === 1 ? fields.render(active[0]!) : nothing}
      ${message ? html`<p role="status" class="stale">${message}</p>` : nothing}
      ${[...proposals.values()].map(
        (pending) =>
          html`<details class="note-proposal">
            <summary>
              Retained note edit · ${pending.songId} · revision
              ${pending.expectedRevision}
            </summary>
            <textarea
              readonly
              aria-label="Retained note edit"
              .value=${JSON.stringify(pending, null, 2)}
            ></textarea>
            <p>
              Copy the proposed changes, refresh the affected notes, and reapply
              after reviewing the current music.
            </p>
            <button
              @click=${() => {
                proposals.delete(pending.operationId);
                message = "";
                c.notify();
              }}
            >
              Dismiss proposed note edit
            </button>
          </details>`,
      )}
      ${fields.retained()}
    </div>`;
  };
  return {
    render,
    tick: (position: number, playing: boolean) => {
      scroll = document.querySelector<HTMLElement>(".degree-scroll");
      const visible = !!scroll?.offsetHeight;
      if (scroll && visible && (!visibleBefore || shownPattern !== patternId)) {
        const selected =
          scroll.querySelector<HTMLElement>(".degree-note.selected") ??
          scroll.querySelector<HTMLElement>(".degree-note:not(.ghost)");
        scroll.scrollTop = selected
          ? selected.offsetTop - scroll.clientHeight / 2
          : 24 * 10;
        shownPattern = patternId;
      }
      visibleBefore = visible;
      const line = scroll?.querySelector<HTMLElement>(".degree-playhead");
      if (line) {
        line.style.transform = `translateX(${64 + (position - value(origin)) * zoom}px)`;
        line.style.opacity = playing ? "1" : "0";
      }
    },
    dispose: () => {
      finishGesture(true);
    },
  };
}
