import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import { sectionLength, sectionSpans } from "../song/arrangement.ts";
import {
  previewCommand,
  type Command,
  type Mutation,
} from "../song/commands.ts";
import type { StructureAction } from "../song/structure.ts";
import { format } from "../song/time.ts";

export function arrangementPanel(c: Controller) {
  let review: {
    mutation: Mutation;
    result: ReturnType<typeof previewCommand>;
  } | null = null;
  const run = async (fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      c.error = String(e);
      c.notify();
    }
  };
  const preview = (action: StructureAction, label: string) =>
    void run(() => {
      const command: Command = { kind: "structure", action };
      const result = previewCommand(c.current!, command);
      review = {
        result,
        mutation: {
          songId: c.current!.id,
          expectedRevision: result.revision,
          operationId: crypto.randomUUID(),
          label,
          command,
        },
      };
      c.notify();
    });
  return () => {
    const s = c.song;
    if (!s) return nothing;
    if (review?.mutation.songId !== s.id) review = null;
    const spans = sectionSpans(s);
    const selected = c.selection;
    const active =
      selected?.table === "arrangement"
        ? s.tables.arrangement[selected.id]
        : null;
    const sid =
      active?.sectionId ??
      (selected?.table === "sections" ? selected.id : undefined);
    const addAnnotation = (table: "phrases" | "lyrics") =>
      void run(async () => {
        const sectionId = sid ?? spans[0]?.sectionId;
        if (!sectionId) throw new Error("Add a section first");
        const id = crypto.randomUUID();
        const r = await c.edit(
          {
            kind: "edit",
            changes: [
              {
                table,
                id,
                value: {
                  id,
                  name: table === "phrases" ? "New phrase" : "New lyric",
                  sectionId,
                  start: [0, 1],
                  duration: sectionLength(s, sectionId),
                  ...(table === "lyrics"
                    ? { text: "", partId: null, phraseId: null }
                    : {}),
                },
              },
            ],
          },
          `Add ${table === "phrases" ? "phrase" : "lyric"}`,
        );
        if (r.ok) c.select({ table, id });
      });
    return html`<section
      class="arrangement-panel"
      aria-label="Arrangement editor"
    >
      <div class="section-title">
        <h2>Arrangement</h2>
        <div class="arrangement-actions">
          <button
            class="secondary"
            @click=${() =>
          void run(async () => {
            const id = crypto.randomUUID(),
              bar = `${id}-bar`,
              appearance = `${id}-once`;
            const prior = Object.values(s.tables.bars).at(-1);
            const r = await c.edit(
              {
                kind: "edit",
                changes: [
                  {
                    table: "sections",
                    id,
                    value: {
                      id,
                      name: `Section ${Object.keys(s.tables.sections).length + 1}`,
                      sourceId: null,
                      barIds: [bar],
                    },
                  },
                  {
                    table: "bars",
                    id: bar,
                    value: {
                      id: bar,
                      name: "Bar 1",
                      sectionId: id,
                      numerator: prior?.numerator ?? 4,
                      denominator: prior?.denominator ?? 4,
                      groups: prior?.groups ?? [1, 1, 1, 1],
                      actual: null,
                    },
                  },
                  {
                    table: "arrangement",
                    id: appearance,
                    value: {
                      id: appearance,
                      name: `Section ${Object.keys(s.tables.sections).length + 1}`,
                      sectionId: id,
                    },
                  },
                  {
                    table: "meta",
                    id: "arrangementOrder",
                    value: [...s.arrangementOrder, appearance],
                  },
                ],
              },
              "Add section",
            );
            if (r.ok) c.select({ table: "sections", id });
          })}
          >
            + Section
          </button>
        </div>
      </div>
      <div class="arrangement-strip">
        ${spans.map(
        (a, i) =>
          html`<button
            class="section-card ${selected?.table === "arrangement" && selected.id === a.id ? "selected" : ""}"
            aria-label=${`Select section ${i + 1}: ${a.name}`}
            @click=${() => c.navigate(c.zoom, a.id)}
          >
            <small>${i + 1} · ${format(a.start)} q</small
            ><strong>${a.name}</strong>
            <small
              >${format(a.length)} q ·
              ${spans.filter((b) => b.sectionId === a.sectionId).length}
              appearances${s.tables.sections[a.sectionId]!.sourceId ? " · variation" : ""}</small
            >
          </button>`,
      )}
      </div>
      ${
        active
          ? html`<div class="arrangement-actions">
              <button
                @click=${() => preview({ type: "repeat", appearanceId: active.id, newId: crypto.randomUUID() }, "Repeat section")}
              >
                Repeat section
              </button>
              <button
                ?disabled=${s.arrangementOrder[0] === active.id}
                @click=${() => preview({ type: "move", appearanceId: active.id, direction: -1 }, "Move section earlier")}
              >
                ← Earlier
              </button>
              <button
                ?disabled=${s.arrangementOrder.at(-1) === active.id}
                @click=${() => preview({ type: "move", appearanceId: active.id, direction: 1 }, "Move section later")}
              >
                Later →
              </button>
              <button
                @click=${() => preview({ type: "variation", appearanceId: active.id, newId: crypto.randomUUID(), name: `${active.name}′` }, "Make section variation")}
              >
                Make section variation
              </button>
              <button
                @click=${() => preview({ type: "remove", appearanceId: active.id }, "Remove section appearance")}
              >
                Remove appearance
              </button>
              <button
                @click=${() => c.select({ table: "sections", id: active.sectionId })}
              >
                Edit shared section
              </button>
            </div>`
          : nothing
      }
      <div class="arrangement-actions">
        <button
          @click=${() =>
        void run(async () => {
          const sectionId = sid ?? spans[0]?.sectionId;
          const patternId = Object.keys(s.tables.patterns)[0],
            voiceId = Object.keys(s.tables.voices)[0];
          if (!sectionId || !patternId || !voiceId)
            throw new Error("Create a section, pattern and voice first");
          const id = crypto.randomUUID();
          const r = await c.edit(
            {
              kind: "edit",
              changes: [
                {
                  table: "occurrences",
                  id,
                  value: {
                    id,
                    name: "Section entrance",
                    sectionId,
                    patternId,
                    voiceId,
                    start: [0, 1],
                    span: sectionLength(s, sectionId),
                    phase: [0, 1],
                    boundary: "continue",
                    tails: "ring",
                  },
                },
              ],
            },
            "Add section entrance",
          );
          if (r.ok) c.select({ table: "occurrences", id });
        })}
        >
          + Entrance</button
        ><button @click=${() => addAnnotation("phrases")}>+ Phrase</button
        ><button @click=${() => addAnnotation("lyrics")}>+ Lyric</button>
        <span class="muted"
          >${sid ? `For ${s.tables.sections[sid]!.name}` : "Select a section to add phrases or lyrics"}</span
        >
      </div>
      ${
        review
          ? html`<div
              class="structure-preview"
              role="region"
              aria-label="Structural edit preview"
            >
              <strong>${review.mutation.label}</strong>
              <p>
                ${review.result.changes.length} objects or fields change.
                ${review.result.fixedGlobalPlacements.length} global placements
                stay fixed.
              </p>
              <p>
                ${review.result.sections.map((a) => `${a.name} at ${format(a.start)} q`).join(" → ")}
              </p>
              <details>
                <summary>Affected objects</summary>
                ${review.result.changes.map((d) => html`<div>${d.table} / ${d.id}</div>`)}
              </details>
              <button
                class="primary"
                @click=${() =>
          void run(async () => {
            const r = await c.mutate(review!.mutation);
            if (r.ok) review = null;
            c.notify();
          })}
              >
                Apply structural edit
              </button>
              <button
                @click=${() => {
          review = null;
          c.notify();
        }}
              >
                Cancel preview
              </button>
              ${review.result.revision !== c.current!.revision ? html`<p role="status">Song changed since this preview. Cancel and preview again.</p>` : nothing}
            </div>`
          : nothing
      }
    </section>`;
  };
}
