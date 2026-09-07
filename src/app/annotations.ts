import { html } from "lit-html";
import type { Controller } from "./controller.ts";
import { annotations } from "../song/arrangement.ts";
import { add, cmp, value, type Time } from "../song/time.ts";

export function annotationLanes(c: Controller, width: number) {
  const s = c.song!,
    spans = annotations(s);
  return (["phrases", "lyrics"] as const).flatMap((table) => {
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
  });
}
