import { html, nothing, render } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { live } from "lit-html/directives/live.js";
import type { NoteView } from "../../generated/desktop/NoteView.ts";
import type { Time } from "../../generated/desktop/Time.ts";
import type { Snapshot } from "./wire.ts";
import type { AgentClient } from "./agent.ts";
import type { AudioClient } from "./audio.ts";
import { audioPanel } from "./audio-view.ts";
import type { MediaClient } from "./media.ts";
import { mediaPanel } from "./media-view.ts";
import type { ProfileClient } from "./profile.ts";
import { profilePanel } from "./profile-view.ts";
import { agentPanel } from "./agent-view.ts";
import { DesktopClient } from "./client.ts";
import { format, fraction, parse, value } from "./coordinates.ts";
import type { Edit, Workbench } from "./workbench.ts";
import { structurePanel } from "./structure-view.ts";
import { objectsPanel } from "./objects-view.ts";
import { harmonyPanel } from "./harmony-view.ts";
import { rhythmPanel } from "./rhythm-view.ts";
import { tabPanel } from "./tab-view.ts";
import { writingPanel } from "./writing-view.ts";
import { takesPanel } from "./takes-view.ts";

const key = (note: NoteView) => `${note.eventId}/${note.memberId ?? ""}`;
interface Draft { value: string; base: Snapshot }
interface Gesture { note: NoteView; base: Snapshot; x: number; pointer: number; element: HTMLElement; moved: boolean; zoom: number; snap: number }

// The workbenches the writer can open. Each one renders projected state and
// proposes actions Rust already accepts; none of them holds musical authority.
const TOOLS = [
  ["structure", "Structure"],
  ["rhythm", "Rhythm"],
  ["harmony", "Harmony"],
  ["tab", "Tab"],
  ["objects", "Objects"],
  ["writing", "Writing"],
  ["takes", "Takes"],
] as const;
type Tool = (typeof TOOLS)[number][0];

export function mountDesktop(root: HTMLElement, client: DesktopClient, agent?: AgentClient, audio?: AudioClient, media?: MediaClient, profiles?: ProfileClient) {
  const transport = audio ? audioPanel(audio) : null;
  const library = media ? mediaPanel(media) : null;
  const accounts = profiles ? profilePanel(profiles, () => client.state?.profile ?? "", () => client.connect()) : null;
  const assistant = agent ? agentPanel(agent) : null;
  const harmony = harmonyPanel(), rhythm = rhythmPanel(), writing = writingPanel();
  let tool: Tool | null = null;
  let selected = "", patternId = "", zoom = 110, snap = 3;
  let titleDraft: Draft | null = null, noteDraft: Draft | null = null;
  let gesture: Gesture | null = null, preview: { key: string; start: Time } | null = null;
  let localError = "", disposed = false;
  const busy = () => client.status !== "ready" || !!client.pending;
  const select = (note: NoteView) => { selected = key(note); noteDraft = null; localError = ""; paint(); };
  const dispatch: Edit = (action, label) => {
    const base = client.state;
    if (base) void client.edit(action, base, label);
  };
  const bench = (state: Snapshot): Workbench => ({ s: state, edit: dispatch, busy: busy(), repaint: paint });
  const openTool = (next: Tool) => { tool = tool === next ? null : next; paint(); };
  const saveTitle = async (e: Event) => {
    e.preventDefault();
    const draft = titleDraft;
    if (draft && await client.edit({ kind: "rename", title: draft.value }, draft.base, "Rename song") && titleDraft === draft) titleDraft = null;
    paint();
  };
  const saveNote = async (e: Event, note: NoteView) => {
    e.preventDefault();
    const draft = noteDraft;
    if (!draft) return;
    try {
      const start = parse(draft.value);
      if (await client.edit({ kind: "moveNote", eventId: note.eventId, memberId: note.memberId, start }, draft.base, `Move ${note.label}`) && noteDraft === draft) noteDraft = null;
      localError = "";
    } catch (error) { localError = String(error); }
    paint();
  };
  const pointerStart = (e: PointerEvent, note: NoteView) => {
    if (busy() || !e.isPrimary || e.button !== 0 || !client.state) return;
    e.preventDefault();
    const element = e.currentTarget as HTMLElement;
    element.focus(); element.setPointerCapture(e.pointerId);
    gesture = { note, base: client.state, x: e.clientX, pointer: e.pointerId, element, moved: false, zoom, snap };
    preview = { key: key(note), start: note.start };
    selected = key(note); noteDraft = null; localError = ""; paint();
  };
  const pointerMove = (e: PointerEvent) => {
    if (!gesture || e.pointerId !== gesture.pointer) return;
    const dx = e.clientX - gesture.x;
    if (Math.abs(dx) >= 3) gesture.moved = true;
    if (gesture.moved) preview = { key: key(gesture.note), start: fraction(Math.round((value(gesture.note.start) + dx / gesture.zoom) * gesture.snap), gesture.snap) };
    paint();
  };
  const finish = async (cancel = false) => {
    const drag = gesture, proposal = preview;
    gesture = null;
    if (drag?.element.hasPointerCapture(drag.pointer)) drag.element.releasePointerCapture(drag.pointer);
    if (!cancel && drag?.moved && proposal) {
      await client.edit({ kind: "moveNote", eventId: drag.note.eventId, memberId: drag.note.memberId, start: proposal.start }, drag.base, `Move ${drag.note.label}`);
    }
    preview = null; paint();
  };
  const keyboard = (e: KeyboardEvent) => {
    if (e.key === "Escape" && gesture) { e.preventDefault(); void finish(true); }
  };
  root.addEventListener("keydown", keyboard);

  function paint() {
    if (disposed) return;
    const s = client.state;
    if (!s) {
      render(html`<main class="desktop-loading"><h1>Songwriter</h1><p role="status">${client.error || "Opening your local sketch…"}</p>
        ${client.status === "offline" ? html`<button @click=${() => client.connect()}>Reconnect</button>` : nothing}</main>`, root);
      return;
    }
    if (!s.patterns.some((p) => p.id === patternId)) patternId = s.patterns[0]?.id ?? "";
    const pattern = s.patterns.find((p) => p.id === patternId);
    const notes = s.notes.filter((n) => n.patternId === patternId);
    const note = notes.find((n) => key(n) === selected);
    const high = Math.max(13, ...notes.map((n) => n.row)) + 1;
    const low = Math.min(0, ...notes.map((n) => n.row));
    const rows = Array.from({ length: high - low + 1 }, (_, i) => high - i);
    const end = Math.max(4, value(pattern?.length ?? [4, 1]), ...notes.map((n) => value(n.start) + value(n.duration)));
    const width = Math.min(12000, Math.max(720, end * zoom + 60));
    const songWidth = Math.max(720, ...s.bars.map((b) => (value(b.start) + value(b.duration)) * 90));
    const status = client.status === "saving" ? "Saving…" : client.status === "connecting" ? "Reconnecting…" : client.status === "offline" ? "Disconnected" : client.pending ? "Save needs checking" : "Saved locally";
    render(html`<div class="desktop-shell" data-revision=${s.revision}>
      <header class="desktop-header">
        <strong class="desktop-brand">SONGWRITER</strong>
        <form class="desktop-title" @submit=${saveTitle}>
          <input aria-label="Song title" .value=${live(titleDraft?.value ?? s.title)} maxlength="10000"
            @input=${(e: Event) => { titleDraft = { value: (e.target as HTMLInputElement).value, base: titleDraft?.base ?? s }; paint(); }} />
          <button ?disabled=${busy() || !titleDraft}>Save title</button>
          ${titleDraft ? html`<button type="button" @click=${() => { titleDraft = null; paint(); }}>Discard title draft</button>` : nothing}
        </form>
        <span class="desktop-profile">${s.profile}</span>
        <span class="desktop-status" role="status">${status}</span>
      </header>
      <div class="desktop-notice">Desktop preview · Your starter sketch is saved on this computer. The assistant supports the same fixture edits as this view.</div>
      <div class="desktop-feedback" role="alert" ?hidden=${!(localError || client.error || s.warning || client.status === "offline" || (client.pending && client.status === "ready"))}>${localError || client.error || s.warning || nothing}
        ${client.error || client.status === "offline" ? html`<button ?disabled=${client.status === "saving" || client.status === "connecting"} @click=${() => client.connect()}>Reconnect</button>` : nothing}
        ${client.pending ? html`<button ?disabled=${client.status !== "ready"} @click=${() => client.retry()}>Retry same edit</button>` : nothing}
      </div>
      <div class="desktop-rack">${transport?.() ?? nothing}${library?.() ?? nothing}${accounts?.() ?? nothing}</div>
      <main class="desktop-main">
        <aside class="desktop-library"><h2>SONG</h2><p>${s.title}</p><hr /><h2>HISTORY</h2>
          ${s.undoable.length ? repeat(s.undoable.slice(-8).reverse(), (u) => u.operationId, (u) => html`<button ?disabled=${busy()}
            @click=${() => client.edit({ kind: "undo", targetId: u.operationId }, s, `Undo ${u.label}`)}>Undo · ${u.label}</button>`) : html`<small>Your edits will appear here.</small>`}
          ${s.redoable.length ? repeat(s.redoable.slice(-8).reverse(), (u) => u.operationId, (u) => html`<button ?disabled=${busy()}
            @click=${() => client.edit({ kind: "undo", targetId: u.operationId }, s, `Redo ${u.label}`)}>Redo · ${u.label}</button>`) : nothing}
          ${assistant?.() ?? nothing}
        </aside>
        <div class="desktop-editors">
          <section class="desktop-arrangement" aria-label="Song arrangement">
            <div class="desktop-section-heading"><h2>ARRANGEMENT</h2><span>Sections · bars · voices</span></div>
            <div class="desktop-timeline-scroll"><div class="desktop-timeline" style=${`width:${songWidth + 100}px`}>
              <div class="desktop-bars">${s.bars.map((bar) => html`<div style=${`left:${100 + value(bar.start) * 90}px;width:${value(bar.duration) * 90}px`}>
                <strong>${bar.section} · ${bar.label}</strong><small>${bar.groups.join(" + ")}</small></div>`)}</div>
              ${s.placements.map((p, i) => html`<div class="desktop-track" style=${`top:${56 + i * 48}px`}><span>${p.voice}</span><button
                style=${`left:${100 + value(p.start) * 90}px;width:${Math.max(30, value(p.duration) * 90 - 2)}px`} aria-pressed=${patternId === p.patternId}
                @click=${() => { patternId = p.patternId; selected = ""; noteDraft = null; paint(); }}>${p.name}</button></div>`)}
            </div></div>
          </section>
          <section class="desktop-notes" aria-label="Relative note editor">
            <div class="desktop-section-heading"><h2>NOTES · 1–7</h2>
              <label>Pattern<select aria-label="Pattern" .value=${patternId} @change=${(e: Event) => { patternId = (e.target as HTMLSelectElement).value; selected = ""; noteDraft = null; paint(); }}>
                ${s.patterns.map((p) => html`<option value=${p.id} ?selected=${p.id === patternId}>${p.name} · ${format(p.length)}q</option>`)}</select></label>
              <label>Snap<select aria-label="Snap" .value=${String(snap)} @change=${(e: Event) => { snap = Number((e.target as HTMLSelectElement).value); }}>
                ${[2, 3, 4, 7].map((n) => html`<option value=${n} ?selected=${n === snap}>1/${n}</option>`)}</select></label>
              <label>Zoom<input aria-label="Note zoom" type="range" min="60" max="200" .value=${String(zoom)} @input=${(e: Event) => { zoom = Number((e.target as HTMLInputElement).value); paint(); }} /></label>
            </div>
            <div class="degree-scroll"><div class="degree-canvas" style=${`width:${width + 64}px;height:${rows.length * 24 + 28}px`}>
              <div class="degree-ruler"><span>1–7</span><div style=${`width:${width}px`}>${Array.from({ length: Math.ceil(width / zoom) }, (_, i) => html`<span style=${`left:${i * zoom}px`}>${i}q</span>`)}</div></div>
              ${rows.map((row, i) => html`<div class="degree-row" style=${`top:${28 + i * 24}px`}><span class="degree-label">${((row % 7) + 7) % 7 + 1}${Math.floor(row / 7) ? ` ${row < 0 ? "↓" : "↑"}${Math.abs(Math.floor(row / 7))}` : ""}</span><div class="degree-cell" style=${`width:${width}px`}></div></div>`)}
              <div class="degree-guides" style=${`left:64px;width:${width}px`}>${Array.from({ length: Math.ceil(width / zoom) }, (_, i) => html`<i style=${`left:${i * zoom}px`}></i>`)}
                <i class="cycle-guide" style=${`left:${value(pattern?.length ?? [0,1]) * zoom}px`} title="Pattern cycle end"></i></div>
              ${repeat(notes, key, (n) => {
                const at = preview?.key === key(n) ? preview.start : n.start;
                return html`<button class="degree-note ${n.memberId ? "chord-member" : ""} ${selected === key(n) ? "selected" : ""}" data-note-key=${key(n)}
                  aria-label=${`${n.label} at ${format(n.start)}${n.memberId ? ` chord member ${n.memberId}` : ""}`} aria-pressed=${selected === key(n)} ?disabled=${busy()}
                  style=${`left:${64 + value(at) * zoom}px;top:${28 + rows.indexOf(n.row) * 24}px;width:${Math.max(12, Math.min(width, value(n.duration) * zoom - 2))}px`}
                  @pointerdown=${(e: PointerEvent) => pointerStart(e, n)} @pointermove=${pointerMove} @pointerup=${() => finish()} @pointercancel=${() => finish(true)}
                  @click=${(e: MouseEvent) => { if (e.detail === 0) select(n); }}>${n.label}</button>`;
              })}
            </div></div>
            <div class="desktop-note-fields">${note ? html`<form @submit=${(e: Event) => saveNote(e, note)}><strong>${note.label}${note.memberId ? " · chord member" : ""}</strong>
              <label>Start (quarter notes)<input aria-label="Note start" .value=${live(noteDraft?.value ?? format(note.start))}
                @input=${(e: Event) => { noteDraft = { value: (e.target as HTMLInputElement).value, base: noteDraft?.base ?? s }; paint(); }} /></label>
              <button ?disabled=${busy() || !noteDraft}>Apply start</button><button type="button" @click=${() => { noteDraft = null; localError = ""; paint(); }}>Use saved value</button>
              <span>Duration ${format(note.duration)}q</span></form>` : html`<p>Select a note to edit its exact start, or drag it horizontally. Escape cancels a drag.</p>`}</div>
          </section>
        </div>
      </main>
      <nav class="desktop-tools" aria-label="Workbenches">
        ${TOOLS.map(([id, label]) => html`<button role="tab" aria-selected=${tool === id}
          @click=${() => openTool(id)}>${label}</button>`)}
      </nav>
      ${tool ? html`<div class="desktop-tray">${
        tool === "structure" ? structurePanel(bench(s))
        : tool === "rhythm" ? rhythm(bench(s))
        : tool === "harmony" ? harmony(bench(s))
        : tool === "tab" ? tabPanel(bench(s))
        : tool === "objects" ? objectsPanel(bench(s))
        : tool === "writing" ? writing(bench(s))
        : takesPanel(bench(s))
      }</div>` : nothing}
    </div>`, root);
  }
  const stop = client.subscribe(paint);
  const stopAgent = agent?.subscribe(paint);
  const stopAudio = audio?.subscribe(paint);
  const stopMedia = media?.subscribe(paint);
  const stopProfiles = profiles?.subscribe(paint);
  paint();
  return () => { disposed = true; stop(); stopAgent?.(); stopAudio?.(); stopMedia?.(); stopProfiles?.(); root.removeEventListener("keydown", keyboard); };
}
