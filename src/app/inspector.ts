import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import type { Table, Entity, Chord, Pitch } from "../song/model.ts";
import { format, parse, type Time } from "../song/time.ts";
export function properties(c: Controller) {
  const sel = c.selection,
    s = c.song,
    e = c.entity();
  if (!sel || !s || !e || sel.table === "events") return nothing;
  const data = e as unknown as Record<string, unknown>;
  const change = async (patch: Record<string, unknown>) => {
    const r = await c.edit(
      {
        kind: "edit",
        changes: [{ table: sel.table, id: e.id, value: { ...e, ...patch } }],
      },
      `Edit ${e.name}`,
    );
    if (!r.ok) c.notify();
  };
  const run = (fn: () => unknown) => {
    try {
      void fn();
    } catch (error) {
      c.error = String(error);
      c.notify();
    }
  };
  const input = (
    key: string,
    label: string,
    kind: "text" | "number" | "time" = "text",
  ) =>
    html`<label
      >${label}<input
        aria-label=${label}
        .value=${kind === "time" ? format(data[key] as Time) : String(data[key] ?? "")}
        @change=${(ev: Event) =>
          run(() => {
            const v = (ev.target as HTMLInputElement).value;
            return change({
              [key]:
                kind === "time" ? parse(v) : kind === "number" ? Number(v) : v,
              ...(key === "numerator" &&
              Number.isInteger(Number(v)) &&
              Number(v) > 0 &&
              Number(v) <= 64
                ? { groups: Array(Number(v)).fill(1) }
                : {}),
            });
          })}
    /></label>`;
  const choice = (
    key: string,
    label: string,
    items: { id: string; name: string }[],
  ) =>
    html`<label
      >${label}<select
        aria-label=${label}
        .value=${String(data[key])}
        @change=${(ev: Event) => void change({ [key]: (ev.target as HTMLSelectElement).value })}
      >
        ${items.map((i) => html`<option value=${i.id}>${i.name}</option>`)}
      </select></label
    >`;
  const refs = (table: Table) => Object.values(s.tables[table]);
  const words = (words: string[]) => words.map((w) => ({ id: w, name: w }));
  switch (sel.table) {
    case "parts":
      return html`<div class="field-grid">
        ${choice("instrument", "Instrument", words(["guitar", "bass", "drums"]))}${input("volume", "Volume · 0 to 1", "number")}<label
          class="check"
          ><input
            type="checkbox"
            .checked=${Boolean(data.muted)}
            @change=${(ev: Event) => void change({ muted: (ev.target as HTMLInputElement).checked })}
          />Mute</label
        >
      </div>`;
    case "voices":
      return choice("partId", "Part", refs("parts"));
    case "patterns":
      return html`${input("length", "Cycle length · quarter notes", "time")}
        <p class="muted">
          Seven eighth notes = 7/2 quarter notes. Notes can ring beyond the
          cycle.
        </p>`;
    case "occurrences":
      return html`<div class="field-grid">
        ${choice("patternId", "Pattern", refs("patterns"))}${choice("voiceId", "Voice", refs("voices"))}${input("start", "Start · quarter notes", "time")}${input("span", "Repeat span", "time")}${input("phase", "Starting phase", "time")}${choice("boundary", "At section boundaries", words(["continue", "restart", "stop"]))}${choice("tails", "At the end", words(["ring", "cut"]))}
      </div>`;
    case "markers":
      return input("at", "Position · quarter notes", "time");
    case "arrangement":
      return html`${choice("sectionId", "Section", refs("sections"))}<button
          @click=${() => {
            const order = [...s.arrangementOrder];
            const i = order.indexOf(e.id);
            if (i > 0) {
              [order[i - 1], order[i]] = [order[i]!, order[i - 1]!];
              void c.edit(
                {
                  kind: "edit",
                  changes: [
                    { table: "meta", id: "arrangementOrder", value: order },
                  ],
                },
                "Move section earlier",
              );
            }
          }}
        >
          Move earlier
        </button>`;
    case "sections":
      return html`<p class="muted">Bars in order</p>
        ${s.tables.sections[e.id]!.barIds.map(
          (id, i) =>
            html`<div class="entity-row">
              <span>${s.tables.bars[id]!.name}</span
              ><button
                ?disabled=${i === 0}
                @click=${() => {
                  const barIds = [...s.tables.sections[e.id]!.barIds];
                  [barIds[i - 1], barIds[i]] = [barIds[i]!, barIds[i - 1]!];
                  void change({ barIds });
                }}
              >
                ↑
              </button>
            </div>`,
        )}`;
    case "bars":
      return html`<div class="field-grid">
          ${input("numerator", "Beats in bar", "number")}${input("denominator", "Note unit", "number")}
        </div>
        <label
          >Grouping<input
            aria-label="Beat grouping"
            .value=${(data.groups as number[]).join("+")}
            @change=${(ev: Event) => run(() => change({ groups: (ev.target as HTMLInputElement).value.split("+").map(Number) }))} /></label
        ><label
          >Pickup length · blank for full bar<input
            aria-label="Pickup length"
            .value=${data.actual ? format(data.actual as Time) : ""}
            @change=${(ev: Event) => run(() => change({ actual: (ev.target as HTMLInputElement).value.trim() ? parse((ev.target as HTMLInputElement).value) : null }))}
        /></label>
        <p class="muted">
          Changing meter preserves note positions. Changing the beat count
          starts with groups of one; enter your grouping next.
        </p>`;
    case "chords": {
      const chord = e as Chord;
      const member = (id: string, patch: Partial<Pitch>) =>
        change({
          notes: chord.notes.map((n) =>
            n.id === id ? { ...n, pitch: { ...n.pitch, ...patch } } : n,
          ),
          label: null,
        });
      return html`<label
          >Roman numeral · optional<input
            aria-label="Roman numeral"
            .value=${chord.label ?? ""}
            @change=${(ev: Event) => void change({ label: (ev.target as HTMLInputElement).value || null })}
        /></label>
        <p class="muted">Contained notes · degree / alteration / octave</p>
        ${chord.notes.map((n) => html`<div class="member">${(["degree", "alteration", "octave"] as const).map((key) => html`<input type="number" aria-label=${`${n.id} ${key}`} .value=${String(n.pitch[key])} @change=${(ev: Event) => void member(n.id, { [key]: Number((ev.target as HTMLInputElement).value) })} />`)}<button aria-label="Remove chord note" @click=${() => void change({ notes: chord.notes.filter((v) => v.id !== n.id), label: null })}>−</button></div>`)}<button
          class="secondary"
          @click=${() => void change({ notes: [...chord.notes, { id: crypto.randomUUID(), pitch: { degree: 1, alteration: 0, octave: 1 } }], label: null })}
        >
          + Chord note
        </button>`;
    }
  }
}
