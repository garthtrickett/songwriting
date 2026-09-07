import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import { previewCommand, type Mutation } from "../song/commands.ts";
import type { RhythmAction } from "../song/rhythm.ts";
import { parse, format, type Time } from "../song/time.ts";
import { rhythmResults } from "./rhythm-results.ts";

/** Forms hold drafts; only a reviewed, revision-bound command reaches storage. */
export function rhythmPanel(c: Controller) {
  let action = "variation",
    laneCount = 2;
  let review: {
    mutation: Mutation;
    result: ReturnType<typeof previewCommand>;
  } | null = null;
  const results = rhythmResults(c);
  const run = async (fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      c.error = String(e);
      c.notify();
    }
  };
  const preview = (a: RhythmAction) => {
    const command = { kind: "rhythm" as const, action: a };
    const result = previewCommand(c.current!, command);
    review = {
      result,
      mutation: {
        songId: c.current!.id,
        expectedRevision: result.revision,
        operationId: crypto.randomUUID(),
        label: `Rhythm: ${a.type}`,
        command,
      },
    };
    c.notify();
  };
  const field = (name: string, label: string, initial: string) =>
    html`<label
      >${label}<input
        name=${name}
        aria-label=${label}
        value=${initial}
        required
    /></label>`;
  const select = (
    name: string,
    label: string,
    items: { id: string; name: string }[],
  ) =>
    html`<label
      >${label}<select name=${name} aria-label=${label}>
        ${items.map((i) => html`<option value=${i.id}>${i.name}</option>`)}
      </select></label
    >`;
  const choices = (name: string, label: string, items: string[]) =>
    select(
      name,
      label,
      items.map((id) => ({ id, name: id })),
    );
  return () => {
    const s = c.song;
    if (!s) return nothing;
    if (review?.mutation.songId !== s.id) review = null;
    const patterns = Object.values(s.tables.patterns),
      occurrences = Object.values(s.tables.occurrences);
    return html`<section class="rhythm-panel" aria-label="Rhythm workbench">
      <h2>Rhythm workbench</h2>
      <p class="muted">
        Exact quarter-note units: an eighth is 1/2. Shared pattern edits affect
        every placement; make a variation to keep the original.
      </p>
      <details open>
        <summary>Transform a rhythm</summary>
        <form
          @submit=${(ev: SubmitEvent) => {
          ev.preventDefault();
          void run(() => {
            const f = new FormData(ev.currentTarget as HTMLFormElement);
            const str = (k: string) => String(f.get(k)),
              t = (k: string) => parse(str(k));
            const patternId = str("pattern"),
              occurrenceId = str("occurrence");
            let a: RhythmAction;
            switch (action) {
              case "variation":
                a = {
                  type: "variation",
                  patternId,
                  newId: crypto.randomUUID(),
                  name: str("name"),
                };
                break;
              case "displace":
                a = { type: "displace", occurrenceId, amount: t("amount") };
                break;
              case "phase":
                a = { type: "phase", occurrenceId, amount: t("amount") };
                break;
              case "rotate":
                a = { type: "rotate", patternId, amount: t("amount") };
                break;
              case "accents":
                a = { type: "accents", patternId, steps: Number(str("steps")) };
                break;
              case "scale":
                a = {
                  type: "scale",
                  patternId,
                  factor: t("factor"),
                  releases: str("releases") as "scale" | "preserve",
                  phases: str("phases") as "follow" | "keep",
                };
                break;
              default:
                a = {
                  type: "splice",
                  patternId,
                  at: t("at"),
                  amount: t("amount"),
                  mode: str("mode") as "insert" | "remove",
                  attacks: str("attacks") as "reject" | "delete",
                  phases: str("phases") as "follow" | "keep",
                };
            }
            preview(a);
          });
        }}
        >
          <div class="field-grid">
            <label
              >Transformation<select
                aria-label="Transformation"
                .value=${action}
                @change=${(e: Event) => {
            action = (e.target as HTMLSelectElement).value;
            c.notify();
          }}
              >
                <option value="variation">Independent variation</option>
                <option value="displace">Displace entrance</option>
                <option value="phase">Shift starting phase</option>
                <option value="rotate">Rotate attacks</option>
                <option value="accents">Rotate accents</option>
                <option value="scale">Scale rhythm</option>
                <option value="splice">Insert or remove time</option>
              </select></label
            >
            ${action === "displace" || action === "phase" ? select("occurrence", "Rhythm placement", occurrences) : select("pattern", "Rhythm pattern", patterns)}
            ${action === "variation" ? field("name", "Variation name", "Riff′") : nothing}
            ${["displace", "phase", "rotate", "splice"].includes(action) ? field("amount", "Amount · quarter notes", "1/2") : nothing}
            ${action === "accents" ? field("steps", "Accent steps", "1") : nothing}
            ${action === "scale" ? html`${field("factor", "Scale factor", "2")}${choices("releases", "Note releases", ["preserve", "scale"])}` : nothing}
            ${action === "splice" ? html`${field("at", "Splice position", "1")}${choices("mode", "Splice mode", ["insert", "remove"])}${choices("attacks", "Attacks in removed time", ["reject", "delete"])}` : nothing}
            ${action === "scale" || action === "splice" ? choices("phases", "Placement phases", ["follow", "keep"]) : nothing}
          </div>
          <p class="muted">
            ${action === "variation" ? "Copies notes and chord definitions. Existing placements keep their pattern; choose the new pattern in a placement to hear it." : action === "splice" ? "Moves attacks; preserves note releases. A cut through a later chord-member attack is rejected." : action === "phase" ? "Wraps within the cycle; keeps the entrance fixed." : action === "rotate" ? "Wraps attacks within the cycle; groups and releases stay fixed." : action === "accents" ? "Moves accents in attack order; rests stay unchanged." : action === "scale" ? "Scales cycle, groups and attacks. Choose whether note durations scale and placement phases follow." : "Moves the entrance in its section or global scope; keeps phase and repeat span."}
          </p>
          <button>Preview rhythm edit</button>
        </form>
      </details>
      <details>
        <summary>Build a polyrhythm</summary>
        <form
          @submit=${(ev: SubmitEvent) => {
          ev.preventDefault();
          void run(() => {
            const f = new FormData(ev.currentTarget as HTMLFormElement),
              str = (k: string) => String(f.get(k));
            preview({
              type: "polyrhythm",
              newId: crypto.randomUUID(),
              name: str("name"),
              sectionId: str("scope") || null,
              start: parse(str("start")),
              duration: parse(str("duration")),
              noteDuration: parse(str("release")),
              lanes: Array.from({ length: laneCount }, (_, i) => ({
                voiceId: str(`voice${i}`),
                divisions: Number(str(`count${i}`)),
                pitch: {
                  degree: Number(str(`degree${i}`)),
                  alteration: Number(str(`alteration${i}`)),
                  octave: Number(str(`octave${i}`)),
                },
                drum: str(`drum${i}`) as "kick" | "snare" | "hat",
              })),
            });
          });
        }}
        >
          <div class="field-grid">
            ${field("name", "Polyrhythm name", "Three against two")}${select("scope", "Polyrhythm scope", [{ id: "", name: "Global · song time" }, ...Object.values(s.tables.sections)])}${field("start", "Polyrhythm start", "0")}${field("duration", "Shared span", "4")}${field("release", "Pulse duration", "1/4")}
          </div>
          ${Array.from(
            { length: laneCount },
            (_, i) =>
              html`<fieldset>
                <legend>Lane ${i + 1}</legend>
                <div class="field-grid">
                  ${select(`voice${i}`, `Lane ${i + 1} voice`, Object.values(s.tables.voices))}${field(`count${i}`, `Lane ${i + 1} divisions`, i === 0 ? "3" : "2")}${field(`degree${i}`, `Lane ${i + 1} degree`, i === 0 ? "1" : "5")}${field(`alteration${i}`, `Lane ${i + 1} alteration`, "0")}${field(`octave${i}`, `Lane ${i + 1} octave`, "0")}${choices(`drum${i}`, `Lane ${i + 1} drum`, ["kick", "snare", "hat"])}
                </div>
              </fieldset>`,
          )}
          <button
            type="button"
            ?disabled=${laneCount >= 8}
            @click=${() => {
            laneCount++;
            c.notify();
          }}
          >
            Add pulse lane
          </button>
          <button
            type="button"
            ?disabled=${laneCount <= 2}
            @click=${() => {
            laneCount--;
            c.notify();
          }}
          >
            Remove pulse lane
          </button>
          <button>Preview polyrhythm</button>
        </form>
      </details>
      ${
        review
          ? html`<div
              class="structure-preview"
              role="region"
              aria-label="Rhythm edit preview"
            >
              <strong>${review.mutation.label}</strong>
              <p>
                ${review.result.changes.length} objects change at revision
                ${review.result.revision}. Applies as one undoable edit.
              </p>
              <p>
                Affected placements:
                ${review.result.affectedPlacements.map((o) => o.name).join(", ") || "none"}.
              </p>
              <ul>
                ${review.result.changes.map((d) => {
          const before = d.before as Record<string, unknown> | null,
            after = d.after as Record<string, unknown> | null;
          const show = (x: unknown) =>
            Array.isArray(x) &&
            x.length === 2 &&
            x.every((n) => typeof n === "number")
              ? format(x as unknown as Time)
              : JSON.stringify(x);
          return html`<li>
            ${d.table} · ${after?.name ?? before?.name ?? d.id}:
            ${
              !before
                ? "created"
                : !after
                  ? "removed"
                  : Object.keys(after)
                      .filter(
                        (k) =>
                          JSON.stringify(before[k]) !==
                          JSON.stringify(after[k]),
                      )
                      .map(
                        (k) => `${k}: ${show(before[k])} → ${show(after[k])}`,
                      )
                      .join("; ")
            }
          </li>`;
        })}
              </ul>
              <button
                class="primary"
                ?disabled=${review.result.revision !== c.current!.revision}
                @click=${() =>
          void run(async () => {
            const r = await c.mutate(review!.mutation);
            if (r.ok) review = null;
            c.notify();
          })}
              >
                Apply rhythm edit
              </button>
              <button
                @click=${() => {
          review = null;
          c.notify();
        }}
              >
                Cancel rhythm preview
              </button>
              ${review.result.revision !== c.current!.revision ? html`<p role="status">Song changed since this preview. Cancel and preview again.</p>` : nothing}
            </div>`
          : nothing
      }
      ${results()}
    </section>`;
  };
}
