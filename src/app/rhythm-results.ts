import { pitchLabel, type MusicalEvent } from "../song/model.ts";
import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import {
  alignmentMap,
  comparePatterns,
  polyrhythmGrid,
} from "../song/rhythm-analysis.ts";
import {
  format,
  parse,
  value,
  sub,
  add,
  ZERO,
  type Time,
} from "../song/time.ts";

const strip = (
  label: string,
  points: Time[],
  from: Time,
  until: Time,
  className = "",
) =>
  html`<div class="pulse-row">
    <span>${label}</span>
    <div
      class="pulse-strip ${className}"
      role="img"
      aria-label=${`${label}: ${points.map(format).join(", ")} quarter notes`}
    >
      ${points.map((t) => html`<i style=${`left:${(100 * value(sub(t, from))) / value(sub(until, from))}%`} title=${`${format(t)} q`}></i>`)}
    </div>
  </div>`;
export function rhythmResults(c: Controller) {
  let songId = "",
    comparison: { sourceId: string; variationId: string } | null = null;
  let alignment: { ids: string[]; from: Time; until: Time } | null = null;
  let polyId = "",
    error = "";
  const query = (fn: () => void) => {
    try {
      fn();
      error = "";
    } catch (e) {
      error = String(e);
    }
    c.notify();
  };
  return () => {
    const s = c.song;
    if (!s) return nothing;
    if (songId !== s.id) {
      songId = s.id;
      comparison = null;
      alignment = null;
      polyId = "";
      error = "";
    }
    let comparisonView = nothing as unknown,
      alignmentView = nothing as unknown,
      polyView = nothing as unknown;
    try {
      if (comparison) {
        const describe = (e: MusicalEvent | null) =>
          !e
            ? "—"
            : [
                e.kind === "chord"
                  ? s.tables.chords[e.chordId!]!.notes.map((n) =>
                      pitchLabel(n.pitch),
                    ).join(" + ")
                  : e.kind === "note"
                    ? pitchLabel(e.pitch)
                    : e.kind === "drum"
                      ? e.drum
                      : "rest",
                `accent ${e.accent}`,
                e.articulation,
                ...e.performance.map(
                  (m) =>
                    `${m.memberId}: +${format(m.offset)} q for ${format(m.duration)} q`,
                ),
              ].join(" · ");
        const result = comparePatterns(
          s,
          comparison.sourceId,
          comparison.variationId,
        );
        const end =
          value(result.source.length) > value(result.variation.length)
            ? result.source.length
            : result.variation.length;
        comparisonView = html`<div aria-label="Pattern comparison">
          <p>
            ${result.source.name} → ${result.variation.name}: cycle
            ${format(result.source.length)} → ${format(result.variation.length)}
            q; grouping ${result.groupsChanged ? "changed" : "unchanged"}.
          </p>
          ${[result.source, result.variation].map((p) => {
            let t = ZERO;
            const boundaries = p.groups.map((g) => {
              const at = t;
              t = add(t, g);
              return at;
            });
            return html`${strip(
              `${p.name} attacks`,
              Object.values(s.tables.events)
                .filter((e) => e.patternId === p.id && e.kind !== "rest")
                .map((e) => e.start),
              ZERO,
              end,
            )}${strip(`${p.name} groups`, boundaries, ZERO, end, "groups")}`;
          })}
          <p class="muted">
            Both patterns use the same time scale, 0–${format(end)} q. Matches
            use event origins; unrelated or older variations may appear as
            additions and removals.
          </p>
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Difference</th>
                <th>Attack A → A′</th>
                <th>Duration A → A′</th>
                <th>Notes & performance A → A′</th>
              </tr>
            </thead>
            <tbody>
              ${result.rows.map(
            (r) =>
              html`<tr>
                <td>${r.after?.name ?? r.before?.name}</td>
                <td>
                  ${r.status}${r.fields.length ? `: ${r.fields.join(", ")}` : ""}
                </td>
                <td>
                  ${r.before ? format(r.before.start) : "—"} →
                  ${r.after ? format(r.after.start) : "—"}
                </td>
                <td>
                  ${r.before ? format(r.before.duration) : "—"} →
                  ${r.after ? format(r.after.duration) : "—"}
                </td>
                <td>${describe(r.before)} → ${describe(r.after)}</td>
              </tr>`,
          )}
            </tbody>
          </table>
        </div>`;
      }
      if (alignment) {
        const result = alignmentMap(
          s,
          alignment.ids,
          alignment.from,
          alignment.until,
        );
        alignmentView = html`<div aria-label="Cycle alignment map">
          <p>
            ${format(result.from)}–${format(result.until)} q ·
            ${result.totalCommon} shared cycle
            starts${result.truncated ? " · Display limited to 512 points per lane" : ""}
          </p>
          ${result.lanes.map((l) => html`${strip(`${l.name} · ${format(l.length)} q · phase ${format(l.phase)} · ${l.total} starts`, l.starts, result.from, result.until)}`)}
          ${strip("Together", result.common, result.from, result.until, "together")}
          ${
            !result.totalCommon
              ? html`<p>No shared cycle start in this range.</p>`
              : html`<p>Mark a shared start:</p>
                  ${result.common.map(
                    (at) =>
                      html`<button
                        @click=${() => {
                          const id = crypto.randomUUID();
                          void c.edit(
                            {
                              kind: "edit",
                              changes: [
                                {
                                  table: "markers",
                                  id,
                                  value: { id, name: "Together", at },
                                },
                              ],
                            },
                            "Mark cycle alignment",
                          );
                        }}
                      >
                        Mark ${format(at)} q
                      </button>`,
                  )}`
          }
        </div>`;
      }
      if (polyId) {
        const grid = polyrhythmGrid(s, polyId);
        polyView = html`<div aria-label="Polyrhythm grid">
          ${
            !grid.length
              ? html`<p>This section has no arranged appearance.</p>`
              : grid.map(
                  (a) =>
                    html`<p>
                        Shared span
                        ${format(a.start)}–${format(add(a.start, a.duration))} q
                      </p>
                      ${a.lanes.map(
                        (l) =>
                          html`<p>
                              ${s.tables.occurrences[l.occurrenceId]!.name} ·
                              ${l.divisions} divisions ·
                              <strong
                                >${l.matches ? "Matches declared grid" : "Differs from declared grid"}</strong
                              >${l.truncated ? " · Display limited to 512 attacks" : ""}
                            </p>
                            ${strip("Expected", l.expected, a.start, add(a.start, a.duration), "groups")}${strip("Actual", l.actual, a.start, add(a.start, a.duration))}<small
                              >Missing:
                              ${l.missing.map(format).join(", ") || "none"}.
                              Extra:
                              ${l.extra.map(format).join(", ") || "none"}.</small
                            >`,
                      )}`,
                )
          }
          <p class="muted">
            The declaration records intent. This compares base attacks;
            chord-member offsets and rests are excluded. Editing music never
            silently rewrites its grid.
          </p>
        </div>`;
      }
    } catch (e) {
      error = String(e);
    }
    const patternSelect = (name: string, label: string) =>
      html`<label
        >${label}<select name=${name} aria-label=${label}>
          ${Object.values(s.tables.patterns).map((p) => html`<option value=${p.id}>${p.name}</option>`)}
        </select></label
      >`;
    return html`<details>
        <summary>Compare A / A′</summary>
        <form
          @submit=${(ev: SubmitEvent) => {
            ev.preventDefault();
            const f = new FormData(ev.currentTarget as HTMLFormElement);
            query(() => {
              comparison = {
                sourceId: String(f.get("source")),
                variationId: String(f.get("variation")),
              };
            });
          }}
        >
          <div class="field-grid">
            ${patternSelect("source", "Compare source")}${patternSelect("variation", "Compare variation")}
          </div>
          <button>Compare patterns</button>
        </form>
        ${comparisonView}
      </details>
      <details>
        <summary>Find cycle alignments</summary>
        <form
          @submit=${(ev: SubmitEvent) => {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget as HTMLFormElement);
        query(() => {
          const next = {
            ids: f.getAll("occurrence").map(String),
            from: parse(String(f.get("from"))),
            until: parse(String(f.get("until"))),
          };
          alignmentMap(s, next.ids, next.from, next.until);
          alignment = next;
        });
      }}
        >
          <fieldset>
            <legend>Choose 2–8 placements</legend>
            ${Object.values(s.tables.occurrences).map((o) => html`<label class="check"><input type="checkbox" name="occurrence" value=${o.id} aria-label=${`Align ${o.name}`} />${o.name}</label>`)}
          </fieldset>
          <div class="field-grid">
            <label
              >Alignment from<input
                name="from"
                aria-label="Alignment from"
                value="0"
                required /></label
            ><label
              >Alignment until<input
                name="until"
                aria-label="Alignment until"
                value="28"
                required
            /></label>
          </div>
          <button>Show alignments</button>
        </form>
        ${alignmentView}
      </details>
      <details>
        <summary>Inspect polyrhythm grids</summary>
        <form
          @submit=${(ev: SubmitEvent) => {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget as HTMLFormElement);
        query(() => {
          polyId = String(f.get("poly"));
        });
      }}
        >
          <label
            >Polyrhythm<select name="poly" aria-label="Inspect polyrhythm">
              ${Object.values(s.tables.polyrhythms).map((p) => html`<option value=${p.id}>${p.name}</option>`)}
            </select></label
          ><button>Show pulse grid</button>
        </form>
        ${polyView}
      </details>
      ${error ? html`<p role="alert">${error}</p>` : nothing}`;
  };
}
