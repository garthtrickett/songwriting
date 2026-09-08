import { html, nothing, type TemplateResult } from "lit-html";
import type { Controller } from "./controller.ts";
import { read, save } from "../storage/projects.ts";

const TOOLS = [
  ["notes", "Notes"],
  ["structure", "Structure"],
  ["rhythm", "Rhythm"],
  ["harmony", "Harmony"],
  ["tab", "Tab"],
  ["audio", "Audio"],
  ["objects", "Objects"],
  ["changes", "Changes / Advanced"],
  ["guidance", "Guidance"],
] as const;
type Tool = (typeof TOOLS)[number][0];
type Panel = "selection" | "agent" | null;
interface Preferences {
  id: string;
  version: 1;
  library: boolean;
  height: number;
  panel: Panel;
}

// Panels stay mounted: hiding a workbench must not throw away a form, capture or task.
export function workspaceLayout(c: Controller, root: HTMLElement) {
  let library = innerWidth >= 1280,
    panel: Panel = innerWidth >= 1280 ? "selection" : null;
  let tool: Tool | null = null,
    height = 260,
    touched = false,
    disposed = false;
  const renderedTools = new Map<Tool, unknown>();
  let saveQueue = Promise.resolve();
  let previousWidth = innerWidth;
  const resize = () => {
    const collapsed = innerWidth < 1280 && previousWidth >= 1280;
    if (collapsed) {
      library = false;
      panel = null;
    }
    previousWidth = innerWidth;
    root.style.setProperty(
      "--tray-height",
      `${Math.max(160, Math.min(height, innerHeight - 470))}px`,
    );
    if (collapsed) c.notify();
  };
  const persist = () => {
    touched = true;
    const state: Preferences = {
      id: "workspace-layout",
      version: 1,
      library,
      height,
      panel,
    };
    saveQueue = saveQueue
      .then(() => save(c.db, "settings", state))
      .catch((error) => {
        c.error = `Could not save layout: ${String(error)}`;
        c.notify();
      });
    resize();
    c.notify();
  };
  void read<Preferences>(c.db, "settings", "workspace-layout")
    .then((p) => {
      if (!p || p.version !== 1 || touched || disposed) return;
      library = innerWidth >= 1280 && p.library === true;
      panel =
        innerWidth >= 1280 && ["selection", "agent"].includes(p.panel ?? "")
          ? p.panel
          : null;
      height = Number.isFinite(p.height)
        ? Math.max(160, Math.min(480, p.height))
        : 260;
      resize();
      c.notify();
    })
    .catch(() => {});
  const setPanel = (next: Panel) => {
    panel = next;
    if (innerWidth < 1280) library = false;
    persist();
  };
  const openTool = (next: Tool) => {
    tool = next;
    if (innerWidth < 700) {
      panel = null;
      library = false;
    }
    persist();
  };
  const close = () => {
    tool = null;
    persist();
    root.querySelector<HTMLElement>('[aria-label="Song timeline"]')?.focus();
  };
  const separatorKey = (e: KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    height =
      e.key === "Home"
        ? 160
        : e.key === "End"
          ? 480
          : height + (e.key === "ArrowUp" ? 20 : -20);
    persist();
  };
  const separatorDrag = (e: PointerEvent) => {
    if (!e.isPrimary || e.button !== 0) return;
    const target = e.currentTarget as HTMLElement,
      origin = e.clientY,
      start = height;
    target.setPointerCapture(e.pointerId);
    const move = (p: PointerEvent) => {
      height = Math.max(160, Math.min(480, start + origin - p.clientY));
      resize();
    };
    const finish = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      persist();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  };
  window.addEventListener("resize", resize);
  resize();
  return {
    get library() {
      return library;
    },
    get panel() {
      return panel;
    },
    get tool() {
      return tool;
    },
    setPanel,
    openTool,
    toggleLibrary() {
      library = !library;
      if (innerWidth < 1280 && library) panel = null;
      persist();
    },
    toolbar: () =>
      html`<nav class="workspace-tools" aria-label="Songwriting tools">
        ${TOOLS.map(
          ([id, label]) =>
            html`<button
              aria-label=${`Open ${label}`}
              aria-pressed=${tool === id}
              @click=${() => (tool === id ? close() : openTool(id))}
            >
              ${label}
            </button>`,
        )}
        <span class="toolbar-spacer"></span>
        <button
          aria-label="Toggle selection panel"
          aria-pressed=${panel === "selection"}
          @click=${() => setPanel(panel === "selection" ? null : "selection")}
        >
          Selection
        </button>
        <button
          aria-label="Toggle agent panel"
          aria-pressed=${panel === "agent"}
          @click=${() => setPanel(panel === "agent" ? null : "agent")}
        >
          Agent
        </button>
        <button
          aria-label="Reset layout"
          @click=${() => {
            library = innerWidth >= 1280;
            panel = innerWidth >= 1280 ? "selection" : null;
            tool = null;
            height = 260;
            persist();
          }}
        >
          ↺ Layout
        </button>
      </nav>`,
    panelTabs: () =>
      html`<div class="panel-tabs">
        <button
          aria-pressed=${panel === "selection"}
          @click=${() => setPanel("selection")}
        >
          Selection</button
        ><button
          aria-pressed=${panel === "agent"}
          @click=${() => setPanel("agent")}
        >
          Agent</button
        ><button aria-label="Close side panel" @click=${() => setPanel(null)}>
          ×
        </button>
      </div>`,
    tray: (views: [Tool, () => unknown][]) =>
      html`<section
        class="tool-tray"
        ?hidden=${!tool}
        aria-label="Song detail tools"
      >
        <div
          class="tray-resize"
          role="separator"
          tabindex="0"
          aria-label="Resize detail editor"
          aria-orientation="horizontal"
          aria-valuemin="160"
          aria-valuemax="480"
          aria-valuenow=${height}
          @keydown=${separatorKey}
          @pointerdown=${separatorDrag}
        ></div>
        <div class="tray-heading">
          <strong>${TOOLS.find(([id]) => id === tool)?.[1]}</strong
          ><span>SONG DETAIL</span
          ><button aria-label="Return to song" @click=${close}>
            Close · Return to song
          </button>
        </div>
        ${views.map(
          ([id, view]) =>
            html`<div
              class="tool-content"
              data-tool=${id}
              ?hidden=${tool !== id}
            >
              ${tool === id
                ? (renderedTools.set(id, view()), renderedTools.get(id))
                : (renderedTools.get(id) ?? nothing)}
            </div>`,
        )}
      </section>`,
    dispose() {
      disposed = true;
      window.removeEventListener("resize", resize);
    },
  };
}
