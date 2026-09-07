import { taskCard } from "./task.ts";
import type { TaskView } from "../agent/tasks.ts";
import { writingPanel } from "./writing.ts";
import { takePlacements } from "../song/media.ts";
import { secondsPerQuarter } from "../song/timeline.ts";
import { mediaPanel } from "./media.ts";
import { takeEditor } from "./takes.ts";
import { frettedPanel } from "./fretted.ts";
import { frettedEditor } from "./fretted-inspector.ts";
import { harmonyPanel } from "./harmony.ts";
import { harmonicRegionEditor, memberPerformanceEditor } from "./harmony-inspector.ts";
import { polyrhythmEditor } from "./polyrhythm.ts";
import { rhythmPanel } from "./rhythm.ts";
import { annotationLanes } from "./annotations.ts";
import { arrangementPanel } from "./arrangement.ts";
import { lyricEditor } from "./lyrics.ts";
import { compositionKeys } from "./keys.ts";
import { placements } from "../song/arrangement.ts";
import { html, render, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { live } from "lit-html/directives/live.js";
import type { Controller } from "./controller.ts";
import {
  TABLES,
  pitchLabel,
  type Table,
  type MusicalEvent,
} from "../song/model.ts";
import {
  bars,
  sounds,
  songEnd,
  alignment,
  segments,
  cycleStarts,
  restSpans,
} from "../song/timeline.ts";
import {
  value,
  format,
  parse,
  add,
  sub,
  cmp,
  type Time,
} from "../song/time.ts";
import { entityChanges, deleteChanges, vary } from "./entities.ts";
import { properties } from "./inspector.ts";
import { executeTool } from "../agent/tools.ts";
export interface AgentView {
  connected: boolean;
  tasks: TaskView[];
  submit(prompt: string): Promise<void>;
  control(id: string, action: "cancel" | "resume"): Promise<void>;
}
export function mount(root: HTMLElement, c: Controller, agent: AgentView) {
  const writing = writingPanel(c, text => {
    const input=root.querySelector<HTMLTextAreaElement>('[aria-label="Agent request"]');
    if(input){input.value=text;input.focus();}
  });
  const media = mediaPanel(c), takes = takeEditor(c);
  const frets = frettedPanel(c), fretEditor = frettedEditor(c);
  const rhythm = rhythmPanel(c), harmony = harmonyPanel(c), harmonicRegions = harmonicRegionEditor(c), members = memberPerformanceEditor(c);
  const arrange = arrangementPanel(c),
    lyrics = lyricEditor(c),
    polyrhythms = polyrhythmEditor(c);
  let step: Time = [1, 2];
  let tab: Table = "patterns",
    draft = "",
    draftKey = "",
    draftDirty = false,
    inspectorError = "",
    revisionAtDraft = 0;
  let advanced = false,
    documentDraft = "",
    documentRevision = 0;
  let alignmentIds: string[] | null = null;
  const handle = (fn: () => unknown) => async () => {
    try {
      const result = await fn();
      if (result && typeof result === "object" && "ok" in result && !result.ok)
        throw new Error(
          String("error" in result ? result.error : "Edit failed"),
        );
    } catch (e) {
      c.error = e instanceof Error ? e.message : String(e);
      c.notify();
    }
  };
  const editEvent = (patch: Partial<MusicalEvent>) =>
    handle(() => {
      const sel = c.selection;
      if (!sel || sel.table !== "events") return;
      const e = c.song!.tables.events[sel.id]!;
      return c.patchEntity("events", e.id, patch, "Edit note");
    });
  const download = () => {
    const blob = new Blob([c.export()], { type: "application/json" });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `${c.song!.title.replace(/[^\w-]/g, "_")}.song.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const newEntity = handle(async () => {
    const id = crypto.randomUUID();
    const r = await c.edit(
      { kind: "edit", changes: entityChanges(tab, c.song!, id) },
      `Create ${tab}`,
    );
    if (r.ok) c.select({ table: tab, id });
    return r;
  });
  const fields = (e: MusicalEvent) =>
    html` <div class="field-grid">
      <label
        >Event<select
          aria-label="Event kind"
          .value=${e.kind}
          @change=${(ev: Event) => {
            const kind = (ev.target as HTMLSelectElement)
              .value as MusicalEvent["kind"];
            void editEvent({
              kind,
              chordId:
                kind === "chord"
                  ? (Object.keys(c.song!.tables.chords)[0] ?? null)
                  : null,
              performance: [],
            })();
          }}
        >
          ${["note", "chord", "drum", "rest"].map((k) => html`<option>${k}</option>`)}
        </select></label
      >
      <label
        >Pattern<select
          .value=${e.patternId}
          @change=${(ev: Event) => void editEvent({ patternId: (ev.target as HTMLSelectElement).value })()}
        >
          ${Object.values(c.song!.tables.patterns).map((p) => html`<option value=${p.id}>${p.name}</option>`)}
        </select></label
      >
      <label
        >Start · quarter notes<input
          aria-label="Note start"
          .value=${format(e.start)}
          @change=${(ev: Event) => void handle(() => editEvent({ start: parse((ev.target as HTMLInputElement).value) })())()}
      /></label>
      <label
        >Duration<input
          aria-label="Note duration"
          .value=${format(e.duration)}
          @change=${(ev: Event) => void handle(() => editEvent({ duration: parse((ev.target as HTMLInputElement).value) })())()}
      /></label>
      ${e.kind === "note" ? html`<label>Degree<input type="number" min="1" max="7" .value=${String(e.pitch.degree)} @change=${(ev: Event) => void editEvent({ pitch: { ...e.pitch, degree: Number((ev.target as HTMLInputElement).value) } })()} /></label><label>Alteration<input type="number" min="-4" max="4" .value=${String(e.pitch.alteration)} @change=${(ev: Event) => void editEvent({ pitch: { ...e.pitch, alteration: Number((ev.target as HTMLInputElement).value) } })()} /></label><label>Octave<input type="number" min="-5" max="5" .value=${String(e.pitch.octave)} @change=${(ev: Event) => void editEvent({ pitch: { ...e.pitch, octave: Number((ev.target as HTMLInputElement).value) } })()} /></label>` : nothing}
      ${
        e.kind === "chord"
          ? html`<label
              >Chord<select
                .value=${e.chordId ?? ""}
                @change=${(ev: Event) => void editEvent({ chordId: (ev.target as HTMLSelectElement).value, performance: [] })()}
              >
                ${Object.values(c.song!.tables.chords).map((ch) => html`<option value=${ch.id}>${ch.label ?? "?"} · ${ch.name}</option>`)}
              </select></label
            >`
          : nothing
      }
      ${
        e.kind === "drum"
          ? html`<label
              >Drum<select
                .value=${e.drum}
                @change=${(ev: Event) => void editEvent({ drum: (ev.target as HTMLSelectElement).value as MusicalEvent["drum"] })()}
              >
                ${["kick", "snare", "hat"].map((k) => html`<option>${k}</option>`)}
              </select></label
            >`
          : nothing
      }
      <label
        >Accent<input
          type="number"
          min="0"
          max="1"
          step="0.1"
          .value=${String(e.accent)}
          @change=${(ev: Event) => void editEvent({ accent: Number((ev.target as HTMLInputElement).value) })()}
      /></label>
      <label
        >Articulation<select
          .value=${e.articulation}
          @change=${(ev: Event) => void editEvent({ articulation: (ev.target as HTMLSelectElement).value as MusicalEvent["articulation"] })()}
        >
          ${["normal", "staccato", "sustain", "muted", "ghost"].map((k) => html`<option>${k}</option>`)}
        </select></label
      >
    </div>`;
  const paint = () => {
    const song = c.song,
      entity = c.entity(),
      key = c.selection
        ? `${c.current?.id}/${c.selection.table}/${c.selection.id}`
        : "";
    if (key !== draftKey && c.selection) tab = c.selection.table;
    if (key !== draftKey || !draftDirty) {
      draft = entity ? JSON.stringify(entity, null, 2) : "";
      draftKey = key;
      draftDirty = false;
      revisionAtDraft = c.current?.revision ?? 0;
    }
    let score: ReturnType<typeof sounds> = [],
      barList: ReturnType<typeof bars> = [];
    try {
      if (song) {
        score = sounds(song);
        barList = bars(song);
      }
    } catch (e) {
      inspectorError = String(e);
    }
    const total = song
      ? Math.max(
          8,
          value(songEnd(song)),
          ...takePlacements(song).map(t=>value(t.at)+t.duration/secondsPerQuarter(song)),
          ...score.map((n) => value(add(n.start, n.duration))),
        )
      : 16;
    const px = c.zoom;
    const width = Math.max(720, total * px);
    render(
      html` <header class="topbar">
          <a class="brand" href="#" @click=${(e: Event) => e.preventDefault()}
            ><span class="mark">∿</span> songwriting<span class="tag"
              >WORKSPACE 01</span
            ></a
          >
          <div class="top-right">
            <span class="save-state"
              >${c.pending ? "Saving…" : c.failed ? "Not saved" : song ? "All changes saved" : "Local workspace"}</span
            ><span class="avatar">G</span>
          </div>
        </header>
        <main>
          <aside class="library">
            <div class="eyebrow">YOUR SONGBOOK</div>
            <div class="library-heading">
              <h2>Ideas in motion</h2>
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
                        >${Object.keys(e.song!.tables.patterns).length} patterns
                        · ${e.song!.mode}</small
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
                  if (f)
                    void handle(async () => c.import(await f.text(), true))();
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
            <div class="library-note">
              <span>Built around the idea.</span>
              <p>
                Relative notes. Independent cycles. Space for the unexpected.
              </p>
            </div>
          </aside>
          <section class="workspace">
            ${
              c.error
                ? html`<div class="error" role="alert">
                    ${c.error}<button
                      @click=${() => {
                        c.error = "";
                        c.notify();
                      }}
                    >
                      Dismiss</button
                    >${c.failed ? html`<button @click=${handle(() => c.mutate(c.failed!))}>Retry saved operation</button>` : nothing}
                  </div>`
                : nothing
            }
            ${
              song
                ? html`
                    <div class="song-heading">
                      <div>
                        <div class="eyebrow">
                          COMPOSITION / ${song.mode.toUpperCase()}
                        </div>
                        <input
                          class="title"
                          aria-label="Song title"
                          .value=${song.title}
                          @change=${(e: Event) => void handle(() => c.patchTitle((e.target as HTMLInputElement).value))()}
                        />
                        <p>
                          Shape the pattern. Find the conversation between
                          parts.
                        </p>
                      </div>
                      <button class="secondary" @click=${handle(download)}>
                        Export JSON · no audio ↗
                      </button>
                    </div>
                    <div class="transport">
                      <button
                        class="play"
                        aria-label=${c.audio.playing ? "Stop" : "Play"}
                        @click=${handle(() => executeTool(c, "transport", { action: c.audio.playing ? "stop" : "play" }))}
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
                          @change=${(e: Event) => void handle(() => c.edit({ kind: "edit", changes: [{ table: "meta", id: "tempo", value: { ...song.tempo, bpm: Number((e.target as HTMLInputElement).value) } }] }, "Change tempo"))()}
                        />
                        BPM</label
                      >
                      <label
                        >Pulse
                        <input
                          aria-label="Tempo beat unit"
                          class="short"
                          .value=${format(song.tempo.beatUnit)}
                          @change=${(e: Event) => void handle(() => c.edit({ kind: "edit", changes: [{ table: "meta", id: "tempo", value: { ...song.tempo, beatUnit: parse((e.target as HTMLInputElement).value) } }] }, "Change beat unit"))()}
                      /></label>
                      <label
                        >Hear in
                        <select
                          aria-label="Playback key"
                          .value=${String(c.audio.tonic)}
                          @change=${(e: Event) => void handle(() => executeTool(c, "transport", { action: "settings", tonic: Number((e.target as HTMLSelectElement).value) }))()}
                        >
                          ${["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"].map((name, i) => html`<option value=${48 + i}>${name}</option>`)}
                        </select></label
                      >
                      <label class="check"
                        ><input
                          type="checkbox"
                          .checked=${c.audio.metronome}
                          @change=${(e: Event) => void handle(() => executeTool(c, "transport", { action: "settings", metronome: (e.target as HTMLInputElement).checked }))()}
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
                          @change=${(e: Event) => void handle(() => executeTool(c, "transport", { action: "seek", position: Number((e.target as HTMLInputElement).value) }))()} /></label
                      ><span class="transport-note"
                        >RELATIVE PITCH · MAJOR REFERENCE</span
                      >
                    </div>
                    ${arrange()}
                    ${rhythm()}
                    ${harmony()}${frets()}${media()}
                    ${c.incoming ? html`<p class="incoming" role="status">${c.incoming}</p>` : nothing}
                    <div class="score-heading">
                      <h2>Song map</h2>
                      <span
                        >${barList.length} bars ·
                        ${Object.keys(song.tables.occurrences).length} patterns
                        in play</span
                      >
                    </div>
                    <div class="timeline-controls">
                      <label
                        >Zoom<input
                          aria-label="Timeline zoom"
                          type="range"
                          min="4"
                          max="128"
                          .value=${String(c.zoom)}
                          @input=${(e: Event) => c.navigate(Number((e.target as HTMLInputElement).value))}
                      /></label>
                      <button
                        @click=${() => c.navigate(Math.max(4, Math.min(128, ((root.querySelector(".score-scroll")?.clientWidth ?? 860) - 140) / total)))}
                      >
                        Fit song
                      </button>
                      <label
                        >Nudge step<input
                          aria-label="Nudge step"
                          .value=${format(step)}
                          @change=${(e: Event) =>
                            void handle(() => {
                              const next = parse(
                                (e.target as HTMLInputElement).value,
                              );
                              if (cmp(next, [0, 1]) <= 0)
                                throw new Error("Step must be positive");
                              step = next;
                            })()}
                      /></label>
                      <small>← → nudge · Ctrl/⌘ Z undo · Shift Z redo</small>
                    </div>
                    <div
                      class="score-scroll"
                      tabindex="0"
                      aria-label="Song timeline"
                    >
                      <div class="score" style=${`width:${width + 140}px`}>
                        <div class="ruler">
                          <span class="lane-name">METER</span>
                          <div class="ruler-body" style=${`width:${width}px`}>
                            ${barList.map(
                              (b) =>
                                html`<button
                                  style=${`left:${value(b.start) * px}px;width:${value(b.length) * px}px`}
                                  @click=${() => {
                                    tab = "bars";
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
                          return html`<div class="lane color-${i % 4}">
                            <button
                              class="lane-name"
                              @click=${() => {
                                tab = "voices";
                                c.select({ table: "voices", id: voice.id });
                              }}
                            >
                              <b>${part.name}</b><small>${voice.name}</small>
                            </button>
                            <div
                              class="lane-body"
                              style=${`width:${width}px;background-size:16px 100%`}
                            >
                              ${placements(song)
                                .filter((o) => o.voiceId === voice.id)
                                .map(
                                  (o) =>
                                    html`<button
                                      class="occurrence ${c.selection?.table === "occurrences" && c.selection.id === o.id ? "chosen" : ""}"
                                      style=${`left:${value(o.start) * px}px;width:${value(o.span) * px}px`}
                                      @click=${() => {
                             tab = "occurrences";
                             c.select({ table: "occurrences", id: o.id });
                           }}
                                    >
                                      ${song.tables.patterns[o.patternId]!.name}
                                      <span
                                        >${format(song.tables.patterns[o.patternId]!.length)}
                                        q ·
                                        ${o.sectionId ? "section" : "global"} ·
                                        ${o.tails}</span
                                      >
                                    </button>`,
                                )}
                              ${placements(song)
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
                              ${restSpans(song)
                                .filter((r) => r.voiceId === voice.id)
                                .map(
                                  (r) =>
                                    html`<button
                                      class="rest-block"
                                      style=${`left:${value(r.start) * px}px;width:${Math.max(10, value(r.duration) * px)}px`}
                                      title="Rest"
                                      @click=${() => {
                             tab = "events";
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
                                      class="note-block ${c.selection?.id === n.eventId ? "chosen" : ""}"
                                      style=${`left:${value(n.start) * px}px;width:${Math.max(5, value(n.duration) * px - 2)}px;top:${n.pitch ? 37 + (7 - n.pitch.degree) * 3 : 46}px;opacity:${Math.max(0.45, n.gain)}`}
                                      title=${`${n.pitch ? pitchLabel(n.pitch) : n.drum} · ${format(n.start)} → ${format(add(n.start, n.duration))}`}
                                      @click=${() => {
                             tab = "events";
                             c.select({ table: "events", id: n.eventId });
                           }}
                                    >
                                      ${n.pitch ? pitchLabel(n.pitch) : n.drum === "kick" ? "●" : n.drum === "snare" ? "×" : "·"}
                                    </button>`,
                                )}
                            </div>
                          </div>`;
                        })}
                        ${Object.keys(song.tables.voices).length === 0 ? html`<div class="score-empty">Build a part, give it a voice, then place a pattern.<br /><small>Use the collection controls below, or work with your agent.</small></div>` : nothing}
                        <div class="marker-lane">
                          <span class="lane-name">MARKERS</span>
                          <div style=${`width:${width}px;position:relative`}>
                            ${Object.values(song.tables.markers).map(
                              (m) =>
                                html`<button
                                  style=${`left:${value(m.at) * px}px`}
                                  @click=${() => {
                                    tab = "markers";
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
                    <div class="editor-grid">
                      <section class="collection">
                        <div class="section-title">
                          <h2>Musical objects</h2>
                          <button class="secondary" @click=${newEntity}>
                            + Add
                          </button>
                        </div>
                        <div class="tabs">
                          ${TABLES.map(
                            (t) =>
                              html`<button
                                class=${tab === t ? "active" : ""}
                                @click=${() => {
                                  tab = t;
                                  c.select(null);
                                }}
                              >
                                ${t}
                              </button>`,
                          )}
                        </div>
                        <div class="entity-list">
                          ${repeat(
                            Object.values(song.tables[tab]),
                            (e) => e.id,
                            (e) =>
                              html`<button
                                class="entity-row ${c.selection?.id === e.id ? "selected" : ""}"
                                @click=${() => c.select({ table: tab, id: e.id })}
                              >
                                <span>${e.name}</span
                                ><small>${e.id.slice(0, 12)}</small>
                              </button>`,
                          )}
                        </div>
                        ${Object.keys(song.tables[tab]).length === 0 ? html`<p class="muted">No ${tab} yet. Add one to start.</p>` : nothing}
                        <div class="alignment-choices">
                          ${Object.values(song.tables.occurrences).map(
                            (o) =>
                              html`<label
                                ><input
                                  type="checkbox"
                                  .checked=${(alignmentIds ?? Object.keys(song.tables.occurrences).slice(0, 2)).includes(o.id)}
                                  @change=${(ev: Event) => {
                                    const ids =
                                      alignmentIds ??
                                      Object.keys(
                                        song.tables.occurrences,
                                      ).slice(0, 2);
                                    alignmentIds = (
                                      ev.target as HTMLInputElement
                                    ).checked
                                      ? [...ids, o.id]
                                      : ids.filter((id) => id !== o.id);
                                    c.notify();
                                  }}
                                />${o.name}</label
                              >`,
                          )}
                        </div>
                        <button
                          class="text-button"
                          @click=${handle(async () => {
                            const ids =
                              alignmentIds ??
                              Object.keys(song.tables.occurrences).slice(0, 2);
                            const at = alignment(
                              song,
                              ids,
                              [0, 1],
                              songEnd(song),
                            );
                            if (!at)
                              throw new Error(
                                "No shared cycle start in the occurrence range",
                              );
                            const id = crypto.randomUUID();
                            return c.edit(
                              {
                                kind: "edit",
                                changes: [
                                  {
                                    table: "markers",
                                    id,
                                    value: {
                                      id,
                                      name: `Cycles meet · ${format(at)} q`,
                                      at,
                                    },
                                  },
                                ],
                              },
                              "Mark cycle alignment",
                            );
                          })}
                        >
                          ↔ Find and mark next cycle alignment
                        </button>
                      </section>
                      <section class="inspector">
                        <div class="section-title">
                          <h2>${entity ? entity.name : "A closer look"}</h2>
                          ${entity ? html`<button class="text-button danger" @click=${handle(() => c.edit({ kind: "edit", changes: deleteChanges(c.selection!.table, entity.id, song) }, `Delete ${entity.name}`))}>Delete</button>` : nothing}
                        </div>
                        ${
                          entity
                            ? html`<label
                                  >Name<input
                                    aria-label="Object name"
                                    .value=${entity.name}
                                    @change=${(e: Event) => void handle(() => c.patchEntity(c.selection!.table, entity.id, { name: (e.target as HTMLInputElement).value }, "Rename object"))()}
                                /></label>
                                ${c.selection?.table === "events" ? html`${fields(entity as MusicalEvent)}${members(entity as MusicalEvent)}` : properties(c, lyrics, polyrhythms, harmonicRegions, fretEditor, takes)}
                                ${
                                  c.selection?.table === "patterns"
                                    ? html`<button
                                        class="secondary"
                                        @click=${handle(async () => {
                               const id = crypto.randomUUID();
                               const r = await c.edit(
                                 {
                                   kind: "edit",
                                   changes: vary(song, entity.id, id),
                                 },
                                 "Create pattern variation",
                               );
                               if (r.ok) c.select({ table: "patterns", id });
                               return r;
                             })}
                                      >
                                        Create variation ↗
                                      </button>`
                                    : nothing
                                }
                                <details>
                                  <summary>Exact properties · JSON</summary>
                                  <p class="muted">
                                    Times are fractions of quarter notes. Edits
                                    are validated together.
                                  </p>
                                  <textarea
                                    class="json"
                                    aria-label="Object JSON"
                                    spellcheck="false"
                                    .value=${live(draft)}
                                    @input=${(e: Event) => {
                                      draft = (e.target as HTMLTextAreaElement)
                                        .value;
                                      draftDirty = true;
                                    }}
                                  ></textarea
                                  ><button
                                    class="secondary"
                                    @click=${() => {
                                      draftDirty = false;
                                      c.notify();
                                    }}
                                  >
                                    Refresh properties</button
                                  ><button
                                    class="primary"
                                    @click=${handle(async () => {
                                      const result = await c.mutate({
                                        songId: song.id,
                                        expectedRevision: revisionAtDraft,
                                        operationId: crypto.randomUUID(),
                                        label: `Edit ${entity.name}`,
                                        command: {
                                          kind: "edit",
                                          changes: [
                                            {
                                              table: c.selection!.table,
                                              id: entity.id,
                                              value: JSON.parse(draft),
                                            },
                                          ],
                                        },
                                      });
                                      if (result.ok) {
                                        draftDirty = false;
                                        c.notify();
                                      }
                                      return result;
                                    })}
                                  >
                                    Apply properties</button
                                  >${draftDirty && revisionAtDraft !== c.current?.revision ? html`<p class="error">Song changed while you were editing. Copy your draft and reselect the object to refresh.</p>` : nothing}
                                </details>`
                            : html`<p class="muted">
                                Select a note, pattern, or bar to edit it. Every
                                object is available to you and your agent.
                              </p>`
                        }
                        ${inspectorError ? html`<p role="alert">${inspectorError}</p>` : nothing}
                      </section>
                    </div>
                    <details class="history">
                      <summary>
                        Change history · ${c.current!.history.length} edits
                      </summary>
                      ${c
                        .current!.history.slice()
                        .reverse()
                        .slice(0, 30)
                        .map(
                          (h) =>
                            html`<div>
                              <span
                                >${h.label}<small
                                  >Revision ${h.revision} ·
                                  ${h.deltas
                                    .slice(0, 8)
                                    .map((d) => {
                                      const v = d.after ?? d.before;
                                      return v &&
                                        typeof v === "object" &&
                                        "name" in v
                                        ? String(v.name)
                                        : `${d.table}/${d.id}`;
                                    })
                                    .join(
                                      ", ",
                                    )}${h.deltas.length > 8 ? "…" : ""}</small
                                ></span
                              ><button
                                @click=${handle(() => c.edit({ kind: "undo", targetId: h.operationId }, `Undo ${h.label}`))}
                              >
                                Undo this change
                              </button>
                            </div>`,
                        )}
                    </details>
                    <details class="document">
                      <summary>Song document · atomic editing</summary>
                      <p class="muted">
                        Use this for related changes that must happen together.
                        Delete referenced objects and their references in one
                        edit.
                      </p>
                      <button
                        class="secondary"
                        @click=${() => {
                          advanced = !advanced;
                          if (advanced) {
                            documentDraft = JSON.stringify(c.song, null, 2);
                            documentRevision = c.current!.revision;
                          }
                          c.notify();
                        }}
                      >
                        ${advanced ? "Close" : "Edit complete song"}</button
                      >${
                        advanced
                          ? html`<form
                              @submit=${(e: SubmitEvent) => {
                                e.preventDefault();
                                const f = e.currentTarget as HTMLFormElement;
                                const expected = Number(
                                  (
                                    f.elements.namedItem(
                                      "revision",
                                    ) as HTMLInputElement
                                  ).value,
                                );
                                const text = (
                                  f.elements.namedItem(
                                    "song",
                                  ) as HTMLTextAreaElement
                                ).value;
                                void handle(() =>
                                  c.mutate({
                                    songId: song.id,
                                    expectedRevision: expected,
                                    operationId: crypto.randomUUID(),
                                    label: "Edit song document",
                                    command: {
                                      kind: "replace",
                                      song: JSON.parse(text),
                                    },
                                  }),
                                )();
                              }}
                            >
                              <input
                                type="hidden"
                                name="revision"
                                value=${documentRevision}
                              /><textarea
                                name="song"
                                aria-label="Song JSON"
                                class="json full"
                                .value=${live(documentDraft)}
                                @input=${(e: Event) => {
                                  documentDraft = (
                                    e.target as HTMLTextAreaElement
                                  ).value;
                                }}
                              ></textarea
                              ><button class="primary">Apply document</button>
                            </form>`
                          : nothing
                      }<button
                        class="text-button danger"
                        @click=${handle(() => c.edit({ kind: "delete" }, "Delete song"))}
                      >
                        Move song to recently deleted
                      </button>
                    </details>
                  `
                : html`<div class="welcome">
                    <div class="eyebrow">A PLACE FOR PATTERNS</div>
                    <h1>Find your<br />next unexpected turn.</h1>
                    <p>
                      Write in degrees. Think in phrases.<br />Let seven meet
                      eight.
                    </p>
                    <button
                      class="primary"
                      @click=${handle(() => c.create("First sketch"))}
                    >
                      Start a song →
                    </button>
                    <button
                      class="secondary"
                      @click=${handle(async () =>
                        c.import(
                          await (
                            await fetch("/turning-rooms.song.json")
                          ).text(),
                          true,
                        ),
                      )}
                    >
                      Explore an example ↗
                    </button>
                  </div>`
            }
          </section>
          <aside class="agent-panel">
            ${writing()}
            <div class="eyebrow">COMPOSING TOGETHER</div>
            <h2>
              Your writing partner
              <span
                class="status-dot ${agent.connected ? "online" : ""}"
              ></span>
            </h2>
            <p class="muted">
              An agent works on the same notes and patterns you do. Every edit
              stays visible.
            </p>
            <form
              @submit=${(e: SubmitEvent) => {
                e.preventDefault();
                const f = e.currentTarget as HTMLFormElement;
                const input = f.elements.namedItem(
                  "prompt",
                ) as HTMLTextAreaElement;
                void handle(async () => {
                  await agent.submit(input.value);
                  input.value = "";
                })();
              }}
            >
              <textarea
                name="prompt"
                aria-label="Agent request"
                placeholder="Make a variation of this riff, one eighth note shorter. Keep the bass unchanged…"
                required
              ></textarea
              ><button class="primary" ?disabled=${!agent.connected}>
                Send to agent ↗
              </button>
            </form>
            <p class="connection">
              ${agent.connected ? "Local bridge connected. A coding agent can claim your task." : "Start bun run bridge to connect an agent. You can keep writing here."}
            </p>
            ${agent.tasks.map(t => taskCard(c,t,agent.control))}
          </aside>
        </main>
        <footer>
          SONGWRITING <span>Structure first. Sound follows.</span
          ><span
            >Saved on this device · export a copy to keep it elsewhere.</span
          >
        </footer>`,
      root,
    );
  };
  const removeKeys = compositionKeys(root, c, () => step);
  const unsubscribe = c.subscribe(paint);
  let navigationVersion = -1;
  paint();
  let frame = 0;
  const tick = () => {
    if (navigationVersion !== c.navigationVersion) {
      const scroll = root.querySelector<HTMLElement>(".score-scroll");
      if (scroll) scroll.scrollLeft = c.jumpTo * c.zoom;
      navigationVersion = c.navigationVersion;
    }
    const line = root.querySelector<HTMLElement>("#playhead");
    if (line) {
      line.style.transform = `translateX(${140 + Math.max(0, c.audio.position) * c.zoom}px)`;
      line.style.opacity = c.audio.playing ? "1" : "0";
    }
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    removeKeys();
    unsubscribe();
    cancelAnimationFrame(frame);
  };
}
