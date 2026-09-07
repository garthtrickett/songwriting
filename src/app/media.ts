import { html, nothing } from "lit-html";
import type { Controller } from "./controller.ts";
import { previewCommand, type Mutation } from "../song/commands.ts";
import type { Take } from "../song/model.ts";
import { parse, format } from "../song/time.ts";
import { takePlacements } from "../song/media.ts";
export function mediaPanel(c: Controller) {
  let state: Awaited<ReturnType<typeof c.media.status>> | null = null,
    key = "",
    busy = false;
  let review: {
    mutation: Mutation;
    take: Take;
    result: ReturnType<typeof previewCommand>;
  } | null = null;
  let chosen = "",
    generation = 0;
  const refresh = async () => {
    const n = ++generation;
    try {
      const result = await c.media.status();
      if (n === generation) state = result;
    } catch (e) {
      c.error = String(e);
    }
    c.notify();
  };
  const run = async (fn: () => Promise<unknown> | unknown) => {
    busy = true;
    c.notify();
    try {
      await fn();
    } catch (e) {
      c.error = String(e);
    } finally {
      busy = false;
      await refresh();
    }
  };
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return () => {
    const s = c.song;
    if (!s) return nothing;
    const nextKey = `${s.id}/${c.current!.revision}/${c.media.recorder.status}/${c.media.recorder.captureId}`;
    if (nextKey !== key) {
      if (!key.startsWith(`${s.id}/`)) {
        review = null;
        chosen = "";
      }
      key = nextKey;
      void refresh();
    }
    const library = state?.assets ?? [],
      asset = library.find((a) => a.id === chosen) ?? library[0];
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
    const recording = c.media.recorder.status;
    return html`<section class="rhythm-panel" aria-label="Recordings and media">
      <h2>Voice and instrumental ideas</h2>
      <p>
        Audio is kept in the local library before you attach it to a song.
        Recorded takes keep their original key and speed.
      </p>
      <p role="status" aria-label="Recording status">
        ${recording} · ${c.media.recorder.activeTracks} microphone
        tracks${busy ? " · working…" : ""}
      </p>
      ${c.media.recorder.error ? html`<p role="alert">${c.media.recorder.error}</p>` : nothing}
      <label
        >Import audio file<input
          type="file"
          accept="audio/*"
          aria-label="Import audio file"
          ?disabled=${busy}
          @change=${(e: Event) => {
     const file = (e.target as HTMLInputElement).files?.[0];
     if (file)
       void run(async () => {
         const a = await c.media.library.import(file, file.name);
         chosen = a.id;
       });
   }}
      /></label>
      <form
        @submit=${(e: SubmitEvent) => {
     e.preventDefault();
     const f = new FormData(e.currentTarget as HTMLFormElement),
       intent = (e.submitter as HTMLButtonElement)?.value;
     void run(async () => {
       const name = String(f.get("name")),
         partId = String(f.get("part")),
         sectionId = String(f.get("scope")) || null,
         start = parse(String(f.get("start")));
       if (intent === "record") {
         return c.media.start({ name, partId, sectionId, start });
       }
       if (!asset) throw new Error("Import or finish recording audio first");
       const take: Take = {
         id: crypto.randomUUID(),
         name,
         assetId: asset.id,
         partId,
         sectionId,
         start,
         offset: 0,
         duration: asset.duration,
         gain: 1,
         muted: false,
       };
       const command = {
         kind: "edit" as const,
         changes: [
           {
             table: "assets" as const,
             id: asset.id,
             value: s.tables.assets[asset.id] ?? asset,
           },
           { table: "takes" as const, id: take.id, value: take },
         ],
       };
       const result = previewCommand(c.current!, command);
       review = {
         take,
         result,
         mutation: {
           songId: s.id,
           expectedRevision: result.revision,
           operationId: crypto.randomUUID(),
           label: `Attach ${name}`,
           command,
         },
       };
     });
   }}
      >
        <div class="field-grid">
          <label
            >Idea name<input
              name="name"
              aria-label="Idea name"
              value="New take" /></label
          >${select("part", "Recording part", Object.values(s.tables.parts))}${select("scope", "Recording placement scope", [{ id: "", name: "Global" }, ...Object.values(s.tables.sections)])}<label
            >Recording placement start<input
              name="start"
              aria-label="Recording placement start"
              value="0"
          /></label>
        </div>
        <button
          name="intent"
          value="record"
          ?disabled=${busy || ["requesting", "recording", "stopping"].includes(recording)}
        >
          Start recording</button
        ><button
          type="button"
          ?disabled=${!["requesting", "recording", "stopping"].includes(recording)}
          @click=${() => void run(() => c.media.recorder.stop())}
        >
          ${recording === "requesting" ? "Cancel microphone request" : "Stop recording"}
        </button>
        <label
          >Audio to attach<select
            aria-label="Audio to attach"
            .value=${asset?.id ?? ""}
            @change=${(e: Event) => {
      chosen = (e.target as HTMLSelectElement).value;
      review = null;
      c.notify();
    }}
          >
            ${library.map((a) => html`<option value=${a.id}>${a.name} · ${a.duration.toFixed(2)} s</option>`)}
          </select></label
        ><button name="intent" value="preview" ?disabled=${busy || !asset}>
          Preview take
        </button>
      </form>
      ${
     review
       ? html`<div aria-label="Take attachment preview">
           <p>
             Revision ${review.mutation.expectedRevision}: ${review.take.name}
             at ${format(review.take.start)} quarters ·
             ${review.take.duration.toFixed(2)} seconds
           </p>
           <button
             ?disabled=${busy || review.mutation.expectedRevision !== c.current!.revision}
             @click=${() =>
               void run(async () => {
                 const p = review!;
                 if (c.song?.id !== p.mutation.songId)
                   throw new Error("Song changed");
                 const r = await c.media.attach(
                   p.take.assetId,
                   p.take,
                   p.mutation.expectedRevision,
                   p.mutation.operationId,
                 );
                 if (r.ok) {
                   review = null;
                   c.select({ table: "takes", id: p.take.id });
                 }
               })}
           >
             Attach take</button
           ><button
             @click=${() => {
               review = null;
               c.notify();
             }}
           >
             Cancel take preview</button
           >${review.mutation.expectedRevision !== c.current!.revision ? html`<p>Song changed; preview the attachment again. Audio remains saved in the library.</p>` : nothing}
         </div>`
       : nothing
   }
      ${state?.missing.length ? html`<p role="alert">Missing audio: ${state.missing.join(", ")}. Import its complete bundle or original audio before auditioning takes.</p>` : nothing}
      <details>
        <summary>Local audio library and capture recovery</summary>
        <button @click=${() => void refresh()}>Refresh media library</button
        >${library.map((a) => html`<p>${a.name} · ${a.bytes} bytes · ${a.duration.toFixed(2)} s <button @click=${() => void run(async () => download((await c.media.library.get(a.id)).blob, `${a.name}.audio`))}>Download ${a.name}</button><button @click=${() => void run(() => c.media.library.removeUnused(a.id))}>Remove unused ${a.name}</button></p>`)}${state?.captures.map(
     (cap) =>
       html`<div>
         <p>
           ${cap.name} · ${cap.status} · song ${cap.songId} · anchor
           ${format(cap.start)} · ${cap.chunks} saved
           chunks${cap.error ? ` · ${cap.error}` : ""}
         </p>
         <button
           @click=${() => void run(() => c.media.recorder.recover(cap.id))}
         >
           Recover ${cap.name}</button
         ><button
           @click=${() => void run(async () => download(await c.media.recorder.raw(cap.id), `${cap.name}.audio`))}
         >
           Download capture ${cap.name}</button
         ><button
           @click=${() => void run(() => c.media.recorder.discard(cap.id))}
         >
           Discard capture ${cap.name}
         </button>
       </div>`,
   )}
      </details>
      <details>
        <summary>Complete media bundles</summary>
        <p>
          Song JSON alone contains metadata. A complete bundle includes the
          audio, with base64 size overhead; up to50 MiB of audio.
        </p>
        <button
          ?disabled=${busy}
          @click=${() => void run(async () => download(new Blob([await c.media.exportBundle()], { type: "application/json" }), `${s.title}.songbundle.json`))}
        >
          Export media bundle</button
        ><label
          >Import media bundle as a copy<input
            type="file"
            accept=".json"
            aria-label="Import media bundle as a copy"
            ?disabled=${busy}
            @change=${(e: Event) => {
     const file = (e.target as HTMLInputElement).files?.[0];
     if (file)
       void run(() =>
         file
           .text()
           .then((text) =>
             c.media.importBundle(text, true, crypto.randomUUID()),
           ),
       );
   }}
        /></label>
      </details>
      ${
     Object.keys(s.tables.takes).length
       ? html`<div aria-label="Recorded take placements">
           <h3>Recorded takes in the song</h3>
           ${takePlacements(s).map((t) => html`<p><button @click=${() => c.select({ table: "takes", id: t.id })}>${t.name}</button> · ${s.tables.parts[t.partId]!.name} · quarter ${format(t.at)} · ${t.duration.toFixed(2)} s · ${t.muted ? "muted alternative" : "audible"}</p>`)}
         </div>`
       : nothing
   }
    </section>`;
  };
}
