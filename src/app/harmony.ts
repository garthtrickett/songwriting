import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import { previewCommand, type Mutation } from "../song/commands.ts";
import type { HarmonyAction } from "../song/harmony.ts";
import { QUALITIES, type ChordRecipe } from "../song/chord-builder.ts";
import { TONIC } from "../song/harmony-pitch.ts";
import {
  pitchLabel,
  semitone,
  type Articulation,
  type Chord,
} from "../song/model.ts";
import { parse, format, add, cmp, ZERO } from "../song/time.ts";
import { harmonyResults } from "./harmony-results.ts";
export function harmonyPanel(c: Controller) {
  let review: {
    mutation: Mutation;
    result: ReturnType<typeof previewCommand>;
  } | null = null;
  const results = harmonyResults(c);
  const field = (name: string, label: string, initial = "") =>
    html`<label
      >${label}<input name=${name} aria-label=${label} value=${initial}
    /></label>`;
  const choice = (
    name: string,
    label: string,
    items: { id: string; name: string }[],
  ) =>
    html`<label
      >${label}<select name=${name} aria-label=${label}>
        ${items.map((i) => html`<option value=${i.id}>${i.name}</option>`)}
      </select></label
    >`;
  const words = (name: string, label: string, items: string[]) =>
    choice(
      name,
      label,
      items.map((id) => ({ id, name: id })),
    );
  const preview = (a: HarmonyAction) => {
    const command = { kind: "harmony" as const, action: a },
      result = previewCommand(c.current!, command);
    review = {
      result,
      mutation: {
        songId: c.current!.id,
        expectedRevision: result.revision,
        operationId: crypto.randomUUID(),
        label: `Harmony: ${a.type}`,
        command,
      },
    };
    c.notify();
  };
  const submit =
    (fn: (str: (k: string) => string, f: FormData) => void) =>
    (e: SubmitEvent) => {
      e.preventDefault();
      try {
        const f = new FormData(e.currentTarget as HTMLFormElement);
        fn((k) => String(f.get(k) ?? ""), f);
      } catch (error) {
        c.error = String(error);
      }
      c.notify();
    };
  return () => {
    const s = c.song;
    if (!s) return nothing;
    if (review?.mutation.songId !== s.id) review = null;
    const chords = Object.values(s.tables.chords),
      patterns = Object.values(s.tables.patterns),
      events = Object.values(s.tables.events),
      chordEvents = events.filter((e) => e.kind === "chord");
    return html`<section class="rhythm-panel" aria-label="Harmony workbench">
      <h2>Harmony workbench</h2>
      <p class="muted">
        Notes stay relative to the song tonic. Local contexts describe how you
        hear them; changing context never moves notes.
      </p>
      <details>
        <summary>Build relative chords</summary>
        <form
          @submit=${submit((str) => {
     const context = s.tables.harmony[str("context")];
     const tones = str("tones").trim()
       ? str("tones")
           .split(",")
           .map((v) => {
             const m = /^([b♭#♯]*)(\d+)$/.exec(v.trim());
             if (!m) throw new Error("Use chord tones such as b9, #11, 6");
             return {
               degree: Number(m[2]),
               alteration: [...m[1]!].reduce(
                 (a, c) => a + (c === "b" || c === "♭" ? -1 : 1),
                 0,
               ),
             };
           })
       : [];
     preview({
       type: "build",
       newId: crypto.randomUUID(),
       name: str("name"),
       eventId: str("event") || null,
       performance: str("performance") as "reset" | "reject",
       recipe: {
         root: str("root"),
         quality: str("quality") as ChordRecipe["quality"],
         extension: Number(str("extension")) as ChordRecipe["extension"],
         seventh: str("seventh") as ChordRecipe["seventh"],
         tones,
         omit: str("omit").trim() ? str("omit").split(",").map(Number) : [],
         inversion: Number(str("inversion")),
         octave: Number(str("octave")),
         target: str("target") || null,
         tonic: context?.tonic ?? TONIC,
       },
     });
   })}
        >
          <div class="field-grid">
            ${field("name", "Chord name", "New harmony")}${field("root", "Roman root", "I")}${words("quality", "Chord quality", [...QUALITIES])}${words("extension", "Extension", ["0", "6", "7", "9", "11", "13"])}${words("seventh", "Seventh quality", ["minor", "major", "diminished"])}${field("tones", "Added or altered tones")}${field("omit", "Omitted tones")}${field("inversion", "Inversion", "0")}${field("octave", "Root octave", "0")}${field("target", "Applied target · optional")}${choice("context", "Chord reference context", [{ id: "", name: "Song tonic I" }, ...Object.values(s.tables.harmony)])}${choice("event", "Assign to chord event", [{ id: "", name: "Create definition only" }, ...chordEvents])}${words("performance", "Existing member performance", ["reject", "reset"])}
          </div>
          <p class="muted">
            Examples: root V, seventh minor, extension 7, target V → V7/V. A
            tone entry overrides/adds that interval above the root. Other parts
            retain their notes.
          </p>
          <button>Preview chord</button>
        </form>
      </details>
      <details>
        <summary>Transpose a pattern</summary>
        <form
          @submit=${submit((str) => preview({ type: "transpose", patternId: str("pattern"), newId: crypto.randomUUID(), steps: Number(str("steps")), semitones: Number(str("semitones")) }))}
        >
          <div class="field-grid">
            ${choice("pattern", "Transpose pattern", patterns)}${field("steps", "Diatonic steps", "3")}${field("semitones", "Chromatic semitones", "5")}
          </div>
          <p class="muted">
            3 steps + 5 semitones is a perfect fourth. Shared chords are copied;
            all placements of this pattern change. Make a variation first to
            preserve the riff.
          </p>
          <button>Preview transposition</button>
        </form>
      </details>
      <details>
        <summary>Develop voice leading</summary>
        <form
          @submit=${submit((str) => preview({ type: "voiceLead", sourceId: str("source"), targetId: str("target"), octaveRadius: Number(str("radius")) }))}
        >
          <div class="field-grid">
            ${choice("source", "Voice-leading source", chords)}${choice("target", "Voice-leading target", chords)}${words("radius", "Octave search radius", ["1", "0", "2"])}
          </div>
          <p class="muted">
            Find minimum total semitone motion by changing target octaves.
            Shared target events change; timing and member identities stay
            fixed. Its old interpretation becomes unresolved.
          </p>
          <button>Preview voicing</button>
        </form>
      </details>
      <details>
        <summary>Shape chord performance</summary>
        <form
          @submit=${submit((str) => {
     const e = s.tables.events[str("event")];
     if (!e || e.kind !== "chord") throw new Error("Choose a chord event");
     const notes = [...s.tables.chords[e.chordId!]!.notes];
     if (str("order") !== "stored")
       notes.sort(
         (a, b) =>
           (semitone(a.pitch) - semitone(b.pitch)) *
           (str("order") === "descending" ? -1 : 1),
       );
     preview({
       type: "perform",
       eventId: e.id,
       order: str("members").trim()
         ? str("members")
             .split(",")
             .map((x) => x.trim())
         : notes.map((n) => n.id),
       step: parse(str("step")),
       duration: str("duration").trim() ? parse(str("duration")) : null,
     });
   })}
        >
          <div class="field-grid">
            ${choice("event", "Performance event", chordEvents)}${words("order", "Member attack order", ["stored", "ascending", "descending"])}${field("members", "Custom member order · optional")}${field("step", "Member attack step", "1/3")}${field("duration", "Common member duration · blank preserves")}
          </div>
          <button>Preview performance</button>
        </form>
      </details>
      <details>
        <summary>Shape expression</summary>
        <form
          @submit=${submit((str, f) => preview({ type: "expression", eventIds: f.getAll("events").map(String), from: Number(str("from")), to: Number(str("to")), articulation: str("articulation") as Articulation, gate: parse(str("gate")) }))}
        >
          <label
            >Expression events<select
              name="events"
              aria-label="Expression events"
              multiple
              size="6"
            >
              ${events.filter((e) => e.kind !== "rest").map((e) => html`<option value=${e.id}>${s.tables.patterns[e.patternId]!.name} · ${e.name} at ${format(e.start)}</option>`)}
            </select></label
          >
          <div class="field-grid">
            ${field("from", "Starting accent", "0.4")}${field("to", "Ending accent", "1")}${words("articulation", "Expression articulation", ["normal", "staccato", "sustain", "muted", "ghost"])}${field("gate", "Duration factor", "1")}
          </div>
          <p class="muted">
            Choose events from one pattern. Accents ramp in attack order; gate
            scales durations, including member overrides. Rests and unselected
            voices stay unchanged.
          </p>
          <button>Preview expression</button>
        </form>
      </details>
      <button
        @click=${async () => {
     let start = ZERO;
     for (const h of Object.values(s.tables.harmony).filter(
       (h) => h.sectionId === null,
     )) {
       const end = add(h.start, h.duration);
       if (cmp(end, start) > 0) start = end;
     }
     const id = crypto.randomUUID();
     const r = await c.edit(
       {
         kind: "edit",
         changes: [
           {
             table: "harmony",
             id,
             value: {
               id,
               name: "Local context",
               sectionId: null,
               start,
               duration: [4, 1],
               tonic: TONIC,
               mode: s.mode,
               annotation: "",
             },
           },
         ],
       },
       "Add harmonic region",
     );
     if (r.ok) c.select({ table: "harmony", id });
   }}
      >
        + Harmonic region
      </button>
      ${
     review
       ? html`<div
           class="structure-preview"
           role="region"
           aria-label="Harmony edit preview"
         >
           <strong>${review.mutation.label}</strong>
           <p>
             ${review.result.changes.length} objects change. Affected
             placements:
             ${review.result.affectedPlacements.map((o) => o.name).join(", ") || "none"}.
           </p>
           <ul>
             ${review.result.changes.map((d) => html`<li>${d.table} · ${d.id}: ${d.after === null ? "removed" : d.table === "chords" ? html`${(d.after as Chord).label ?? "unresolved"} · ${(d.after as Chord).notes.map((n) => `${n.id}: ${pitchLabel(n.pitch)}`).join("; ")} · reference ${pitchLabel((d.after as Chord).labelTonic)}` : JSON.stringify(d.after)}</li>`)}
           </ul>
           <button
             class="primary"
             ?disabled=${review.result.revision !== c.current!.revision}
             @click=${async () => {
               const r = await c.mutate(review!.mutation);
               if (r.ok) review = null;
               c.notify();
             }}
           >
             Apply harmony edit</button
           ><button
             @click=${() => {
               review = null;
               c.notify();
             }}
           >
             Cancel harmony preview</button
           >${review.result.revision !== c.current!.revision ? html`<p role="status">Song changed. Cancel and preview again.</p>` : nothing}
         </div>`
       : nothing
   }
      ${results()}
    </section>`;
  };
}
