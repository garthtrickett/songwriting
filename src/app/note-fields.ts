import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { Controller } from "./controller.ts";
import type { Envelope, Change } from "../song/commands.ts";
import { changeNotes, noteKey, type EditableNote } from "../song/note-edit.ts";
import { parse, format } from "../song/time.ts";
interface Fields {
  start: string;
  duration: string;
  degree: string;
  alteration: string;
  octave: string;
  base: Envelope;
  note: EditableNote;
  dirty: boolean;
}

export function noteFields(
  c: Controller,
  commit: (
    base: Envelope,
    changes: Change[],
    label: string,
  ) => ReturnType<Controller["mutate"]>,
) {
  const drafts = new Map<string, Fields>();
  const run = async (fn: () => unknown) => {
    try {
      await fn();
    } catch (error) {
      c.error = String(error);
      c.notify();
    }
  };
  const fieldView = (n: EditableNote) => {
    const key = `${c.song!.id}/${noteKey(n)}`;
    let d = drafts.get(key);
    if (!d || !d.dirty) {
      d = {
        start: format(n.start),
        duration: format(n.duration),
        degree: String(n.pitch.degree),
        alteration: String(n.pitch.alteration),
        octave: String(n.pitch.octave),
        base: c.current!,
        note: n,
        dirty: false,
      };
      drafts.set(key, d);
    }
    const draft = d;
    return html`<form
      class="note-fields"
      @submit=${(e: SubmitEvent) => {
        e.preventDefault();
        void run(async () => {
          const result = await commit(
            draft.base,
            changeNotes(draft.base.song!, [
              {
                ...draft.note,
                start: parse(draft.start),
                duration: parse(draft.duration),
                pitch: {
                  degree: Number(draft.degree),
                  alteration: Number(draft.alteration),
                  octave: Number(draft.octave),
                },
              },
            ]),
            "Edit relative note",
          );
          if (result.ok) {
            drafts.delete(key);
            c.notify();
          }
        });
      }}
    >
      <strong>${n.memberId ? `Member ${n.memberId}` : "Note"}</strong>
      ${(
        [
          ["start", "Start · q"],
          ["duration", "Length · q"],
          ["degree", "Degree"],
          ["alteration", "♭ / ♯"],
          ["octave", "Octave"],
        ] as const
      ).map(
        ([key, label]) =>
          html`<label
            >${label}<input
              aria-label=${`Editor ${key}`}
              .value=${live(draft[key])}
              @input=${(e: Event) => {
                draft[key] = (e.target as HTMLInputElement).value;
                draft.dirty = true;
              }}
          /></label>`,
      )}
      <button>Apply note fields</button
      ><button
        type="button"
        @click=${() => {
          drafts.delete(key);
          c.notify();
        }}
      >
        Reload note fields
      </button>
      ${draft.dirty && draft.base.revision !== c.current!.revision
        ? html`<span role="status" class="stale"
            >Song changed · draft retained</span
          >`
        : nothing}
    </form>`;
  };
  return {
    render: fieldView,
    retained: () => {
      const s = c.song!;
      return html`${[...drafts]
        .filter(
          ([key, d]) =>
            d.dirty &&
            !s.tables.events[d.note.eventId] &&
            key.startsWith(s.id + "/"),
        )
        .map(
          ([key, d]) =>
            html`<details>
              <summary>Deleted note · retained draft</summary>
              <textarea
                readonly
                .value=${JSON.stringify(d.note) +
                JSON.stringify({
                  start: d.start,
                  duration: d.duration,
                  degree: d.degree,
                  alteration: d.alteration,
                  octave: d.octave,
                })}
              ></textarea
              ><button
                @click=${() => {
                  drafts.delete(key);
                  c.notify();
                }}
              >
                Dismiss deleted note draft
              </button>
            </details>`,
        )}`;
    },
  };
}
