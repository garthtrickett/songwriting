import { executeTool } from "../agent/tools.ts";
import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import { type Fingering, pitchLabel } from "../song/model.ts";
import { fretPositions, TUNINGS } from "../song/fretted.ts";
import { tablature } from "../song/tablature.ts";
import { previewCommand, type Mutation } from "../song/commands.ts";
import { format, parse, type Time } from "../song/time.ts";
export function frettedPanel(c: Controller) {
  let songId = "",
    arrangementId = "",
    from: Time = [0, 1],
    until: Time = [32, 1];
  let found: {
    revision: number;
    arrangementId: string;
    occurrenceId: string;
    eventId: string;
    memberId: string | null;
    result: ReturnType<typeof fretPositions>;
  } | null = null;
  let review: {
    mutation: Mutation;
    result: ReturnType<typeof previewCommand>;
  } | null = null;
  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      c.error = String(e);
    }
    c.notify();
  };
  return () => {
    const s = c.song;
    if (!s) return nothing;
    if (songId !== s.id) {
      songId = s.id;
      arrangementId = "";
      found = null;
      review = null;
    }
    const arrangements = Object.values(s.tables.fretted);
    const a = s.tables.fretted[arrangementId] ?? arrangements[0];
    let tab: ReturnType<typeof tablature> | null = null,
      problem = "";
    if (a)
      try {
        tab = tablature(s, a.id, from, until);
      } catch (e) {
        problem = String(e);
      }
    const targets = a
      ? Object.values(s.tables.occurrences)
          .filter((o) => s.tables.voices[o.voiceId]!.partId === a.partId)
          .flatMap((o) =>
            Object.values(s.tables.events)
              .filter((e) => e.patternId === o.patternId)
              .flatMap((e) =>
                (e.kind === "chord"
                  ? s.tables.chords[e.chordId!]!.notes.map((n) => ({
                      memberId: n.id,
                      pitch: n.pitch,
                    }))
                  : e.kind === "note"
                    ? [{ memberId: null, pitch: e.pitch }]
                    : []
                ).map((n) => ({
                  value: JSON.stringify([o.id, e.id, n.memberId]),
                  name: `${o.name} · ${e.name} · ${pitchLabel(n.pitch)}${n.memberId ? ` (${n.memberId})` : ""}`,
                })),
              ),
          )
      : [];
    return html`<section class="rhythm-panel" aria-label="Fretted arrangements">
      <h2>Guitar and bass arrangements</h2>
      <p class="muted">
        Choose a key, tuning and capo without changing relative music. Positions
        repeat with their placement; inspect sustained voices together.
      </p>
      <button
        @click=${async () => {
        try {
          const part = Object.values(s.tables.parts).find((p) =>
            ["guitar", "bass"].includes(p.instrument),
          );
          if (!part) throw new Error("Create a guitar or bass part first");
          const id = crypto.randomUUID();
          const r = await c.edit(
            {
              kind: "edit",
              changes: [
                {
                  table: "fretted",
                  id,
                  value: {
                    id,
                    name: `${part.name} arrangement`,
                    partId: part.id,
                    tonic: c.audio.tonic,
                    tuning:
                      TUNINGS[
                        part.instrument === "bass"
                          ? "Standard bass"
                          : "Standard guitar"
                      ],
                    capo: 0,
                    maxFret: 24,
                    handSpan: 4,
                  },
                },
              ],
            },
            "Create fretted arrangement",
          );
          if (r.ok) {
            arrangementId = id;
            c.select({ table: "fretted", id });
          }
        } catch (e) {
          c.error = String(e);
          c.notify();
        }
      }}
      >
        + Fretted arrangement
      </button>
      ${
        a
          ? html`<label
                >Active fretted arrangement<select
                  aria-label="Active fretted arrangement"
                  .value=${a.id}
                  @change=${(e: Event) => {
                    arrangementId = (e.target as HTMLSelectElement).value;
                    found = null;
                    review = null;
                    c.notify();
                  }}
                >
                  ${arrangements.map((a) => html`<option value=${a.id}>${a.name}</option>`)}
                </select></label
              ><button @click=${() => c.select({ table: "fretted", id: a.id })}>
                Edit tuning and capo
              </button>
              <p>
                Tonic MIDI ${a.tonic} · open strings ${a.tuning.join(" / ")} ·
                capo ${a.capo}. Fret numbers count from capo.
              </p>
              ${
          a.tonic !== c.audio.tonic
            ? html`<p>
                Audition tonic differs (${c.audio.tonic}).
                <button
                  @click=${() =>
                    void executeTool(c, "transport", {
                      action: "settings",
                      tonic: a.tonic,
                    }).catch((e) => {
                      c.error = String(e);
                      c.notify();
                    })}
                >
                  Audition arrangement key
                </button>
              </p>`
            : nothing
        }
              <details open>
                <summary>Find string positions</summary>
                <form
                  @submit=${(e: SubmitEvent) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget as HTMLFormElement);
          run(() => {
            const [occurrenceId, eventId, memberId] = JSON.parse(
              String(form.get("target")),
            ) as [string, string, string | null];
            found = {
              revision: c.current!.revision,
              arrangementId: a.id,
              occurrenceId,
              eventId,
              memberId,
              result: fretPositions(s, a.id, occurrenceId, eventId, memberId),
            };
            review = null;
          });
        }}
                >
                  <label
                    >Note to finger<select
                      name="target"
                      aria-label="Note to finger"
                    >
                      ${targets.map((t) => html`<option value=${t.value}>${t.name}</option>`)}
                    </select></label
                  ><button>Find positions</button>
                </form>
                ${
          found
            ? html`<div aria-label="Position choices">
                <p>
                  ${pitchLabel(found.result.pitch)} · MIDI
                  ${found.result.midi}${found.result.unplayable ? " · No in-range position" : ""}
                </p>
                ${found.result.positions.map(
                  (p) =>
                    html`<button
                      ?disabled=${found!.revision !== c.current!.revision}
                      @click=${() =>
                        run(() => {
                          if (found!.revision !== c.current!.revision)
                            throw new Error(
                              "Refresh position choices after edits",
                            );
                          const f = found!;
                          const old = Object.values(s.tables.fingerings).find(
                            (x) =>
                              x.arrangementId === f.arrangementId &&
                              x.occurrenceId === f.occurrenceId &&
                              x.eventId === f.eventId &&
                              x.memberId === f.memberId,
                          );
                          const id = old?.id ?? crypto.randomUUID();
                          const value: Fingering = {
                            id,
                            name: `${pitchLabel(f.result.pitch)} · string ${p.string}`,
                            arrangementId: f.arrangementId,
                            occurrenceId: f.occurrenceId,
                            eventId: f.eventId,
                            memberId: f.memberId,
                            string: p.string,
                            fret: p.fret,
                            technique: old?.technique ?? "pluck",
                            fromId: old?.fromId ?? null,
                          };
                          const command = {
                            kind: "edit" as const,
                            changes: [
                              { table: "fingerings" as const, id, value },
                            ],
                          };
                          review = {
                            mutation: {
                              songId: s.id,
                              expectedRevision: f.revision,
                              operationId: crypto.randomUUID(),
                              label: "Assign string position",
                              command,
                            },
                            result: previewCommand(c.current!, command),
                          };
                        })}
                    >
                      String ${p.string} · fret ${p.fret}
                    </button>`,
                )}${found.revision !== c.current!.revision ? html`<p>Song changed; find positions again.</p>` : nothing}
              </div>`
            : nothing
        }
                ${
          review
            ? html`<div aria-label="Fingering preview">
                <pre>${JSON.stringify(review.result.changes, null, 2)}</pre>
                <button
                  ?disabled=${review.mutation.expectedRevision !== c.current!.revision}
                  @click=${async () => {
                    const pending = review!;
                    const r = await c.mutate(pending.mutation);
                    if (r.ok) {
                      review = null;
                      found = null;
                      c.select({
                        table: "fingerings",
                        id: pending.result.changes[0]!.id,
                      });
                    }
                    c.notify();
                  }}
                >
                  Apply fingering</button
                ><button
                  @click=${() => {
                    review = null;
                    c.notify();
                  }}
                >
                  Cancel fingering preview
                </button>
              </div>`
            : nothing
        }
              </details>
              <form
                @submit=${(e: SubmitEvent) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget as HTMLFormElement);
          run(() => {
            from = parse(String(f.get("from")));
            until = parse(String(f.get("until")));
          });
        }}
              >
                <label
                  >Tab from<input
                    name="from"
                    aria-label="Tab from"
                    value=${format(from)} /></label
                ><label
                  >Tab until<input
                    name="until"
                    aria-label="Tab until"
                    value=${format(until)} /></label
                ><button>Inspect tablature</button>
              </form>
              ${
          tab
            ? html`<p>
                  ${tab.total} notes · ${tab.issueCount} notes need
                  attention${tab.truncated ? " · showing first 512" : ""}.
                  Hand-span checks are guidance; positions need a player's
                  judgement.
                </p>
                <div class="tab-scroll" aria-label="Timed tablature">
                  <table>
                    <thead>
                      <tr>
                        <th>Quarter</th>
                        ${tab.rows.map((n) => html`<th>${format(n.start)}</th>`)}
                      </tr>
                    </thead>
                    <tbody>
                      ${a.tuning.map(
                        (open, i) =>
                          html`<tr>
                            <th>String ${i + 1} (${open})</th>
                            ${tab!.rows.map((n) => html`<td>${n.fingering?.string === i + 1 ? html`<button title=${n.issues.join("; ")} @click=${() => c.select({ table: "fingerings", id: n.fingering!.id })}>${n.fingering.fret}${n.issues.length ? " ⚠" : ""}</button>` : "—"}</td>`)}
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>
                <div aria-label="Tab note details">
                  <table>
                    <thead>
                      <tr>
                        <th>Start / release length</th>
                        <th>Voice / note</th>
                        <th>Position / technique</th>
                        <th>Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${tab.rows.map(
                        (n) =>
                          html`<tr>
                            <td>${format(n.start)} / ${format(n.duration)}</td>
                            <td>
                              ${s.tables.voices[n.voiceId]!.name} ·
                              ${pitchLabel(n.pitch!)}
                            </td>
                            <td>
                              ${n.fingering ? html`<button @click=${() => c.select({ table: "fingerings", id: n.fingering!.id })}>${n.fingering.string}:${n.fingering.fret} · ${n.fingering.technique}</button>` : "Unassigned"}
                            </td>
                            <td>${n.issues.join("; ")}</td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>
                ${tab.stale.map((f) => html`<p role="alert"><button @click=${() => c.select({ table: "fingerings", id: f.id })}>Review ${f.id}</button>: ${f.issues.join("; ")}</p>`)}${tab.unplaced.length ? html`<p>Assignments without a realised attack in the song: ${tab.unplaced.join(", ")}</p>` : nothing}`
            : nothing
        } `
          : nothing
      }${problem ? html`<p role="alert">${problem}</p>` : nothing}
    </section>`;
  };
}
