import { guard } from "lit-html/directives/guard.js";
import { actions } from "./actions.ts";
import { eventFields } from "./event-fields.ts";
import { transport } from "./transport.ts";
import { songLibrary } from "./song-library.ts";
import { songMap, songExtent } from "./song-map.ts";
import { workspaceLayout } from "./workspace-layout.ts";
import { noteEditor } from "./note-editor.ts";
import { taskCard } from "./task.ts";
import type { TaskView } from "../agent/tasks.ts";
import { writingPanel } from "./writing.ts";
import { mediaPanel } from "./media.ts";
import { takeEditor } from "./takes.ts";
import { frettedPanel } from "./fretted.ts";
import { frettedEditor } from "./fretted-inspector.ts";
import { harmonyPanel } from "./harmony.ts";
import {
  harmonicRegionEditor,
  memberPerformanceEditor,
} from "./harmony-inspector.ts";
import { polyrhythmEditor } from "./polyrhythm.ts";
import { rhythmPanel } from "./rhythm.ts";
import { arrangementPanel } from "./arrangement.ts";
import { lyricEditor } from "./lyrics.ts";
import { compositionKeys } from "./keys.ts";
import { html, render, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { live } from "lit-html/directives/live.js";
import type { Controller } from "./controller.ts";
import { TABLES, type Table, type MusicalEvent } from "../song/model.ts";
import { bars, songEnd, alignment } from "../song/timeline.ts";
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
export interface AgentView {
  connected: boolean;
  tasks: TaskView[];
  submit(prompt: string): Promise<void>;
  control(id: string, action: "cancel" | "resume"): Promise<void>;
}
export function mount(root: HTMLElement, c: Controller, agent: AgentView) {
  const layout = workspaceLayout(c, root);
  const map = songMap(c);
  const notes = noteEditor(c);
  const writing = writingPanel(c, (text) => {
    layout.setPanel("agent");
    const input = root.querySelector<HTMLTextAreaElement>(
      '[aria-label="Agent request"]',
    );
    if (input) {
      input.value = text;
      input.focus();
    }
  });
  const media = mediaPanel(c),
    takes = takeEditor(c);
  const frets = frettedPanel(c),
    fretEditor = frettedEditor(c);
  const rhythm = rhythmPanel(c),
    harmony = harmonyPanel(c),
    harmonicRegions = harmonicRegionEditor(c),
    members = memberPerformanceEditor(c);
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
  const objectDrafts = new Map<string, { text: string; revision: number }>();
  let advanced = false,
    documentDraft = "",
    documentRevision = 0;
  let alignmentIds: string[] | null = null;
  const handle = actions(c);
  const fields = eventFields(c);
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
  const paint = () => {
    const song = c.song,
      entity = c.entity(),
      key = c.selection
        ? `${c.current?.id}/${c.selection.table}/${c.selection.id}`
        : "";
    if (key !== draftKey && c.selection) tab = c.selection.table;
    if (key !== draftKey && draftDirty)
      objectDrafts.set(draftKey, { text: draft, revision: revisionAtDraft });
    if (key !== draftKey || !draftDirty) {
      draft = entity ? JSON.stringify(entity, null, 2) : "";
      draftKey = key;
      draftDirty = false;
      revisionAtDraft = c.current?.revision ?? 0;
      const retained = objectDrafts.get(key);
      if (retained) {
        draft = retained.text;
        revisionAtDraft = retained.revision;
        draftDirty = true;
      }
    }
    const barList = song ? bars(song) : [];
    const total = song ? songExtent(song) : 16;
    const width = Math.max(640, total * c.zoom);
    const collection = () =>
      song
        ? html`
            <section class="collection">
              <div class="section-title">
                <h2>Musical objects</h2>
                <button class="secondary" @click=${newEntity}>+ Add</button>
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
                      class="entity-row ${c.selection?.id === e.id
                        ? "selected"
                        : ""}"
                      @click=${() => c.select({ table: tab, id: e.id })}
                    >
                      <span>${e.name}</span><small>${e.id.slice(0, 12)}</small>
                    </button>`,
                )}
              </div>
              ${Object.keys(song.tables[tab]).length === 0
                ? html`<p class="muted">No ${tab} yet. Add one to start.</p>`
                : nothing}
              <div class="alignment-choices">
                ${Object.values(song.tables.occurrences).map(
                  (o) =>
                    html`<label
                      ><input
                        type="checkbox"
                        .checked=${(
                          alignmentIds ??
                          Object.keys(song.tables.occurrences).slice(0, 2)
                        ).includes(o.id)}
                        @change=${(ev: Event) => {
                          const ids =
                            alignmentIds ??
                            Object.keys(song.tables.occurrences).slice(0, 2);
                          alignmentIds = (ev.target as HTMLInputElement).checked
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
                  const at = alignment(song, ids, [0, 1], songEnd(song));
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
          `
        : nothing;
    const inspector = () =>
      song
        ? html`
            <section class="inspector">
              <div class="section-title">
                <h2>${entity ? entity.name : "A closer look"}</h2>
                ${entity
                  ? html`<button
                      class="text-button danger"
                      @click=${handle(() =>
                        c.edit(
                          {
                            kind: "edit",
                            changes: deleteChanges(
                              c.selection!.table,
                              entity.id,
                              song,
                            ),
                          },
                          `Delete ${entity.name}`,
                        ),
                      )}
                    >
                      Delete
                    </button>`
                  : nothing}
              </div>
              ${entity
                ? html`<label
                      >Name<input
                        aria-label="Object name"
                        .value=${entity.name}
                        @change=${(e: Event) =>
                          void handle(() =>
                            c.patchEntity(
                              c.selection!.table,
                              entity.id,
                              { name: (e.target as HTMLInputElement).value },
                              "Rename object",
                            ),
                          )()}
                    /></label>
                    ${c.selection?.table === "events"
                      ? html`${layout.tool === "notes"
                          ? html`<p class="muted">
                              Pitch and timing are open in Notes. Close Notes to
                              use the full event inspector.
                            </p>`
                          : fields(entity as MusicalEvent)}${members(
                          entity as MusicalEvent,
                        )}`
                      : properties(
                          c,
                          lyrics,
                          polyrhythms,
                          harmonicRegions,
                          fretEditor,
                          takes,
                        )}
                    ${c.selection?.table === "patterns"
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
                      : nothing}
                    <details>
                      <summary>Exact properties · JSON</summary>
                      <p class="muted">
                        Times are fractions of quarter notes. Edits are
                        validated together.
                      </p>
                      <textarea
                        class="json"
                        aria-label="Object JSON"
                        spellcheck="false"
                        .value=${live(draft)}
                        @input=${(e: Event) => {
                          draft = (e.target as HTMLTextAreaElement).value;
                          draftDirty = true;
                        }}
                      ></textarea
                      ><button
                        class="secondary"
                        @click=${() => {
                          draftDirty = false;
                          objectDrafts.delete(key);
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
                            objectDrafts.delete(key);
                            c.notify();
                          }
                          return result;
                        })}
                      >
                        Apply properties</button
                      >${draftDirty && revisionAtDraft !== c.current?.revision
                        ? html`<p class="error">
                            Song changed while you were editing. Your draft is
                            preserved. Copy it or Refresh properties before
                            reapplying.
                          </p>`
                        : nothing}
                    </details>`
                : html`<p class="muted">
                    Select a note, pattern, or bar to edit it. Every object is
                    available to you and your agent.
                  </p>`}
              ${[...objectDrafts]
                .filter(([savedKey]) => savedKey !== key)
                .map(
                  ([savedKey, d]) =>
                    html`<details>
                      <summary>Retained object draft · ${savedKey}</summary>
                      <textarea
                        readonly
                        aria-label=${`Retained draft ${savedKey}`}
                        .value=${d.text}
                      ></textarea
                      ><button
                        @click=${() => {
                          objectDrafts.delete(savedKey);
                          c.notify();
                        }}
                      >
                        Dismiss retained draft
                      </button>
                    </details>`,
                )}
              ${inspectorError
                ? html`<p role="alert">${inspectorError}</p>`
                : nothing}
            </section>
          `
        : nothing;
    const extras = () =>
      song
        ? html`
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
                              return v && typeof v === "object" && "name" in v
                                ? String(v.name)
                                : `${d.table}/${d.id}`;
                            })
                            .join(", ")}${h.deltas.length > 8 ? "…" : ""}</small
                        ></span
                      ><button
                        @click=${handle(() =>
                          c.edit(
                            { kind: "undo", targetId: h.operationId },
                            `Undo ${h.label}`,
                          ),
                        )}
                      >
                        Undo this change
                      </button>
                    </div>`,
                )}
            </details>
            <details class="document">
              <summary>Song document · atomic editing</summary>
              <p class="muted">
                Use this for related changes that must happen together. Delete
                referenced objects and their references in one edit.
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
              >${advanced
                ? html`<form
                    @submit=${(e: SubmitEvent) => {
                      e.preventDefault();
                      const f = e.currentTarget as HTMLFormElement;
                      const expected = Number(
                        (f.elements.namedItem("revision") as HTMLInputElement)
                          .value,
                      );
                      const text = (
                        f.elements.namedItem("song") as HTMLTextAreaElement
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
                        documentDraft = (e.target as HTMLTextAreaElement).value;
                      }}
                    ></textarea
                    ><button class="primary">Apply document</button>
                  </form>`
                : nothing}<button
                class="text-button danger"
                @click=${handle(() =>
                  c.edit({ kind: "delete" }, "Delete song"),
                )}
              >
                Move song to recently deleted
              </button>
            </details>
          `
        : nothing;
    const agentPanel = () => html`
      <aside class="agent-panel">
        <div class="eyebrow">COMPOSING TOGETHER</div>
        <h2>
          Your writing partner
          <span class="status-dot ${agent.connected ? "online" : ""}"></span>
        </h2>
        <p class="muted">
          An agent works on the same notes and patterns you do. Every edit stays
          visible.
        </p>
        <form
          @submit=${(e: SubmitEvent) => {
            e.preventDefault();
            const f = e.currentTarget as HTMLFormElement;
            const input = f.elements.namedItem("prompt") as HTMLTextAreaElement;
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
          ${agent.connected
            ? "Local bridge connected. A coding agent can claim your task."
            : "Start bun run bridge to connect an agent. You can keep writing here."}
        </p>
        ${agent.tasks.map((t) => taskCard(c, t, agent.control))}
      </aside>
    `;
    render(
      html` <header class="topbar">
          <button
            class="library-toggle"
            aria-label="Toggle song list"
            aria-pressed=${layout.library}
            @click=${() => layout.toggleLibrary()}
          >
            ☰
          </button>
          <span class="brand"><span class="mark">∿</span> songwriting</span>
          ${transport(c)}
          <div class="top-right">
            <span class="save-state"
              >${c.pending
                ? "Saving…"
                : c.failed
                  ? "Not saved"
                  : song
                    ? "All changes saved"
                    : "Local workspace"}</span
            >
          </div>
        </header>
        <main
          class=${`studio ${layout.library ? "library-open" : ""} ${layout.panel ? "panel-open" : ""}`}
        >
          ${songLibrary(c)}
          <section class="workspace">
            ${c.error
              ? html`<div class="error" role="alert">
                  ${c.error}<button
                    @click=${() => {
                      c.error = "";
                      c.notify();
                    }}
                  >
                    Dismiss</button
                  >${c.failed
                    ? html`<button @click=${handle(() => c.mutate(c.failed!))}>
                        Retry saved operation
                      </button>`
                    : nothing}
                </div>`
              : nothing}
            ${song
              ? html`
                  <div class="song-heading">
                    <div>
                      <input
                        class="title"
                        aria-label="Song title"
                        .value=${song.title}
                        @change=${(e: Event) =>
                          void handle(() =>
                            c.patchTitle((e.target as HTMLInputElement).value),
                          )()}
                      />
                    </div>
                    <button class="secondary" @click=${handle(download)}>
                      Export JSON · no audio ↗
                    </button>
                  </div>
                  ${layout.toolbar()}

                  <div class="score-heading">
                    <h2>Song map</h2>
                    <span
                      >${barList.length} bars ·
                      ${Object.keys(song.tables.occurrences).length} patterns in
                      play</span
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
                        @input=${(e: Event) =>
                          c.navigate(
                            Number((e.target as HTMLInputElement).value),
                          )}
                    /></label>
                    <button
                      @click=${() =>
                        c.navigate(
                          Math.max(
                            4,
                            Math.min(
                              128,
                              ((root.querySelector(".score-scroll")
                                ?.clientWidth ?? 860) -
                                140) /
                                total,
                            ),
                          ),
                        )}
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
                  ${guard([song, c.zoom], () => map.render(width))}
                  ${layout.tray([
                    ["notes", notes.render],
                    ["structure", arrange],
                    ["rhythm", rhythm],
                    ["harmony", harmony],
                    ["tab", frets],
                    ["audio", media],
                    ["objects", collection],
                    ["changes", extras],
                    ["guidance", writing],
                  ])}
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
                        await (await fetch("/turning-rooms.song.json")).text(),
                        true,
                      ),
                    )}
                  >
                    Explore an example ↗
                  </button>
                </div>`}
          </section>
          <aside class="detail-panel" ?hidden=${!layout.panel}>
            ${layout.panelTabs()}
            <div class="panel-content" ?hidden=${layout.panel !== "selection"}>
              ${inspector()}
            </div>
            <div class="panel-content" ?hidden=${layout.panel !== "agent"}>
              ${agentPanel()}
            </div>
          </aside>
        </main>
        <footer>
          <span>ARRANGEMENT</span><span>1–7 · relative to tonic</span>
          <button
            class="capture-status"
            @click=${() => layout.openTool("audio")}
          >
            Audio · ${c.media.recorder.status}
          </button>
          ${["requesting", "recording", "stopping"].includes(
            c.media.recorder.status,
          )
            ? html`<button @click=${handle(() => c.media.recorder.stop())}>
                Stop capture
              </button>`
            : nothing}
          <button @click=${() => layout.setPanel("agent")}>
            Agent · ${agent.connected ? "connected" : "offline"} ·
            ${["pending", "running", "waiting", "partial", "failed"]
              .map((status) => ({
                status,
                count: agent.tasks.filter((t) => t.status === status).length,
              }))
              .filter((s) => s.count)
              .map((s) => `${s.count} ${s.status}`)
              .join(" · ") || "idle"}
          </button>
          ${c.incoming
            ? html`<span class="incoming">${c.incoming}</span>`
            : nothing}
        </footer>`,
      root,
    );
    map.select(root);
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
    notes.tick(c.audio.position, c.audio.playing);
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    layout.dispose();
    notes.dispose();
    removeKeys();
    unsubscribe();
    cancelAnimationFrame(frame);
  };
}
