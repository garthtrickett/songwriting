import type { Controller } from "./controller.ts";
import { add, type Time } from "../song/time.ts";
export function compositionKeys(
  root: HTMLElement,
  c: Controller,
  step: () => Time,
) {
  const handler = (e: KeyboardEvent) => {
    const target = e.target;
    if (
      !(target instanceof HTMLElement) ||
      target.closest(
        "input, textarea, select, [contenteditable], [role=textbox]",
      )
    )
      return;
    let action: (() => unknown) | undefined;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z")
      action = () => c.historyAction(e.shiftKey ? "redo" : "undo");
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y")
      action = () => c.historyAction("redo");
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (e.code === "Space" && target.tagName !== "BUTTON")
      action = () =>
        c.audio.playing
          ? c.audio.stop()
          : c.song && c.audio.play(c.song, c.audio.position);
    else if (e.key === "Escape") action = () => c.select(null);
    else if (
      (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
      ["occurrences", "events"].includes(c.selection?.table ?? "")
    ) {
      action = () => {
        const sel = c.selection!;
        const entity = c.song!.tables[sel.table][sel.id] as unknown as {
          start: Time;
        };
        const amount = step();
        return c.edit(
          {
            kind: "edit",
            changes: [
              {
                table: sel.table,
                id: sel.id,
                value: {
                  ...entity,
                  start: add(
                    entity.start,
                    e.key === "ArrowLeft" ? [-amount[0], amount[1]] : amount,
                  ),
                },
              },
            ],
          },
          "Nudge musical position",
        );
      };
    }
    if (action) {
      e.preventDefault();
      void Promise.resolve()
        .then(action)
        .catch((error) => {
          c.error = String(error);
          c.notify();
        });
    }
  };
  root.addEventListener("keydown", handler);
  return () => root.removeEventListener("keydown", handler);
}
