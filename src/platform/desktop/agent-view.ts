import { html, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { AgentClient } from "./agent.ts";

export function agentPanel(client: AgentClient) {
  let provider = "anthropic", model = "", prompt = "";
  return () => {
    const task = client.state.task;
    const running = task?.status === "running";
    const pending = running || task?.status === "interrupted";
    return html`<section class="desktop-agent" aria-label="Song assistant">
      <h2>ASSISTANT</h2>
      <details ?open=${!client.state.configuredModel}><summary>Model settings</summary>
        <p>The provider receives your request and the local sketch when inspected. Your key is kept for this app session only.</p>
        <form @submit=${async (e: SubmitEvent) => {
          e.preventDefault(); const form = e.currentTarget as HTMLFormElement;
          const input = form.elements.namedItem("apiKey") as HTMLInputElement;
          const apiKey = input.value; input.value = "";
          await client.configure({ provider, model, apiKey });
        }}>
          <label>Provider<select aria-label="Agent provider" @change=${(e: Event) => { provider = (e.target as HTMLSelectElement).value; }}>
            <option value="anthropic">Anthropic</option><option value="openrouter">OpenRouter</option>
          </select></label>
          <label>Model<input aria-label="Agent model" required maxlength="150" .value=${live(model)} @input=${(e: Event) => { model = (e.target as HTMLInputElement).value; }} /></label>
          <label>API key<input name="apiKey" aria-label="Agent API key" type="password" autocomplete="off" required maxlength="4096" /></label>
          <button ?disabled=${client.busy || running}>Use for this session</button>
        </form>
      </details>
      <small>${client.state.configuredModel ?? "Configure a model to start"}</small>
      <form @submit=${async (e: SubmitEvent) => { e.preventDefault(); if (await client.start(prompt)) prompt = ""; }}>
        <label>Request<textarea aria-label="Agent request" maxlength="8000" required .value=${live(prompt)}
          @input=${(e: Event) => { prompt = (e.target as HTMLTextAreaElement).value; }} placeholder="Inspect the sketch and rename it to Crooked Steps"></textarea></label>
        <button ?disabled=${client.busy || pending || !client.state.configuredModel}>Send to agent</button>
      </form>
      ${client.error ? html`<p role="alert">${client.error}</p>` : nothing}
      ${task ? html`<div class="desktop-agent-task" data-agent-status=${task.status}>
        <strong>${task.status} · ${task.rounds}/12 model requests</strong>
        <p>${task.prompt}</p><p role="status">${task.message}</p>
        ${task.status === "interrupted" ? html`<button ?disabled=${client.busy || client.state.configuredModel !== task.model} @click=${() => client.resume(task.id)}>Resume agent</button>` : nothing}
        ${pending ? html`<button ?disabled=${client.busy} @click=${() => client.cancel(task.id)}>Cancel agent</button>` : nothing}
      </div>` : nothing}
      <small>Edits appear in History and can be undone. Playback is still coming.</small>
    </section>`;
  };
}
