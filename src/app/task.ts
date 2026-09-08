import { html, nothing } from "lit-html";
import type { TaskView } from "../agent/tasks.ts";
import type { Controller } from "./controller.ts";
export function taskCard(
  c: Controller,
  t: TaskView,
  control: (id: string, action: "cancel" | "resume") => Promise<void>,
) {
  const items = t.checkpoint.items,
    done = items.filter((i) =>
      ["completed", "skipped"].includes(i.status),
    ).length;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      c.error = String(e);
      c.notify();
    }
  };
  return html`<article class="task" data-task-id=${t.id}>
    <small>${t.status.toUpperCase()}</small>
    <p>${t.prompt}</p>
    <p class="muted">
      ${t.provider} ${t.model} · ${t.snapshot.toolVersion === "legacy"
        ? html`${t.stepCount} calls`
        : html`segment ${t.segment} · ${t.segmentCalls}/100
          calls this segment · ${t.stepCount}/1000 total`}
    </p>
    ${t.needsContext ? html`<p role="status">A fresh context read is required before continuing.</p>` : nothing}
    ${
      items.length
        ? html`<p role="status">${done}/${items.length} work items complete</p>
            <ul>
              ${items.map((i) => html`<li>${i.status}: ${i.title}${i.note ? html`<p class="muted">${i.note}</p>` : nothing}</li>`)}
            </ul>`
        : nothing
    }
    ${t.checkpoint.summary ? html`<p>${t.checkpoint.summary}</p>` : nothing}
    ${t.checkpoint.nextStep ? html`<p>Next: ${t.checkpoint.nextStep}</p>` : nothing}
    ${t.steps.map((st) => {
      const effect = st.effect,
        h =
          effect && c.current?.id === effect.songId
            ? c.current.history.find(
                (h) => h.operationId === effect.operationId,
              )
            : null;
      return html`<div class="step">
          ${st.error ? "!" : st.status === "done" ? "✓" : "·"} ${st.name}
          ${st.status}
        </div>
        ${st.error ? html`<p role="status">${st.error}</p>` : nothing}
        ${
        effect
          ? html`<details>
              <summary>
                Review change: ${effect.label} · revision ${effect.revision}
              </summary>
              <p>${effect.affectedTotal} objects · ${effect.operationId}</p>
              ${
                h
                  ? html`${h.deltas.map(
                        (d) =>
                          html`<details>
                            <summary>${d.table} / ${d.id}</summary>
                            <pre>
Before: ${JSON.stringify(d.before, null, 2)}
After: ${JSON.stringify(d.after, null, 2)}</pre>
                          </details>`,
                      )}<button
                        @click=${() => void run(() => c.mutate({ songId: effect.songId, expectedRevision: c.current!.revision, operationId: crypto.randomUUID(), label: `Undo ${effect.label}`, command: { kind: "undo", targetId: effect.operationId } }))}
                      >
                        Undo this task change
                      </button>`
                  : html`<p>
                      Open the affected song to inspect its durable change
                      history.
                    </p>`
              }
            </details>`
          : nothing
      }`;
    })}
    ${t.summary ? html`<p>${t.summary}</p>` : nothing}
    <details>
      <summary>Task guidance snapshot</summary>
      ${t.snapshot.toolVersion === "legacy" ? html`<p>
        Guidance snapshot unavailable for this older task. Restart the bridge
        after updating to use current agent workflows.
      </p>` : html`
      <p>
        Song ${t.snapshot.songId ?? "none"} · revision
        ${t.snapshot.revision ?? "none"} · ${t.snapshot.toolVersion}
      </p>
      <pre>
${t.snapshot.instructions}
${t.snapshot.preferences}</pre>`}
    </details>
    <button
      class="text-button"
      @click=${() => void run(() => control(t.id, t.status === "running" || t.status === "pending" ? "cancel" : "resume"))}
    >
      ${t.status === "running" || t.status === "pending" ? "Cancel" : "Resume"}
    </button>
  </article>`;
}
