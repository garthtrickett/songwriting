import { takePlacements } from "../song/media.ts";
import { secondsPerQuarter } from "../song/timeline.ts";
import { harmonicSpans } from "../song/harmony-analysis.ts";
import { pitchLabel } from "../song/model.ts";
import { html } from "lit-html";
import type { Controller } from "./controller.ts";
import { annotations } from "../song/arrangement.ts";
import { add, cmp, value, type Time } from "../song/time.ts";

export function annotationLanes(c: Controller, width: number) {
  const s = c.song!,
    spans = annotations(s);
  const renderedAnnotations = (["phrases", "lyrics"] as const).flatMap(
    (table) => {
      const rows: { end: Time; items: typeof spans }[] = [];
      for (const item of spans
        .filter((e) => e.table === table)
        .sort((a, b) => cmp(a.start, b.start))) {
        let row = rows.find((r) => cmp(r.end, item.start) <= 0);
        if (!row) {
          row = { end: [0, 1], items: [] };
          rows.push(row);
        }
        row.items.push(item);
        row.end = add(item.start, item.duration);
      }
      if (!rows.length) rows.push({ end: [0, 1], items: [] });
      return rows.map(
        (row, i) =>
          html`<div class="annotation-lane">
            <span class="lane-name">${i ? "" : table.toUpperCase()}</span>
            <div style=${`width:${width}px;position:relative`}>
              ${row.items.map(
              (e) =>
                html`<button
                  class=${`annotation ${table}`}
                  style=${`left:${value(e.start) * c.zoom}px;width:${Math.max(10, value(e.duration) * c.zoom)}px`}
                  title=${table === "lyrics" ? s.tables.lyrics[e.id]!.text : e.name}
                  @click=${() => c.select({ table, id: e.id })}
                >
                  ${table === "lyrics" ? s.tables.lyrics[e.id]!.text || e.name : e.name}
                </button>`,
            )}
            </div>
          </div>`,
      );
    },
  );
  const harmony = harmonicSpans(s);
  return [
    ...[true, false].map(
      (local) =>
        html`<div class="annotation-lane">
          <span class="lane-name"
            >${local ? "LOCAL HARMONY" : "GLOBAL HARMONY"}</span
          >
          <div style=${`width:${width}px;position:relative`}>
            ${harmony.filter((h) => (h.sectionId !== null) === local).map((h) => html`<button class="annotation harmonic-region" style=${`left:${value(h.start) * c.zoom}px;width:${Math.max(10, value(h.duration) * c.zoom)}px`} title=${h.annotation} @click=${() => c.select({ table: "harmony", id: h.id })}>${h.name} · ${pitchLabel(h.tonic)} ${h.mode}</button>`)}
          </div>
        </div>`,
    ),
    ...renderedAnnotations,
    ...takePlacements(s).map(t => html`<div class="annotation-lane"><span class="lane-name">${s.tables.parts[t.partId]!.name} · AUDIO</span><div style=${`width:${width}px;position:relative`}><button class="annotation recorded-take" style=${`left:${value(t.at)*c.zoom}px;width:${Math.max(10,t.duration/secondsPerQuarter(s)*c.zoom)}px;opacity:${t.muted?0.4:1}`} title=${`${t.name}: ${t.duration} seconds from source ${t.offset}`} @click=${()=>c.select({table:"takes",id:t.id})}>${t.name}${t.muted?" · muted":""}</button></div></div>`),
  ];
}
