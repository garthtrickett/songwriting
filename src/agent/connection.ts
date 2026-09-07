import type { Controller } from "../app/controller.ts";
import { executeTool } from "./tools.ts";
import { read, save } from "../storage/projects.ts";
import type { AgentView } from "../app/view.ts";
interface Job {
  taskId: string;
  songId: string | null;
  step: { id: string; name: string; args: Record<string, unknown> };
}
export function connection(
  c: Controller,
): AgentView & { start(): void; stop(): void } {
  const clientId =
    sessionStorage.getItem("songwriting-client") ?? crypto.randomUUID();
  sessionStorage.setItem("songwriting-client", clientId);
  let timer: ReturnType<typeof setTimeout> | null = null,
    stopped = false;
  const inflight = new Set<string>();
  const request = async (path: string, body?: unknown) => {
    const r = await fetch(`/bridge${path}`, {
      headers: {
        "x-songwriting-client": "browser",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 300));
    return r.json();
  };
  const view: AgentView & { start(): void; stop(): void } = {
    connected: false,
    tasks: [],
    async submit(prompt) {
      await request("/task", {
        clientId,
        songId: c.current?.id ?? null,
        prompt,
        snapshot: {songId:c.current?.id??null,revision:c.current?.revision??null,instructions:c.song?.writing.instructions??"",preferences:c.song?.writing.preferences??"",toolVersion:"phase7-workflows-v1"},
      });
      await poll();
    },
    async control(id, action) {
      await request("/control", { id, action, clientId });
      await poll();
    },
    start() {
      void poll();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
  async function poll() {
    if (stopped) return;
    try {
      const status = await request(`/status?clientId=${clientId}`);
      const changed =
        !view.connected ||
        JSON.stringify(view.tasks) !== JSON.stringify(status.tasks);
      view.connected = true;
      view.tasks = status.tasks;
      if (changed) c.notify();
      const jobs = (await request(`/poll?clientId=${clientId}`)) as Job[];
      for (const job of jobs) {
        if (inflight.has(job.step.id)) continue;
        inflight.add(job.step.id);
        try {
          let checkpoint = await read<{ id: string; result: unknown }>(
            c.db,
            "sessions",
            job.step.id,
          );
          if (!checkpoint) {
            let result: unknown;
            try {
              // Mutation targets are explicit. Read/transport tools cannot silently jump to another open song.
              if (
                job.songId &&
                c.current?.id !== job.songId &&
                job.step.name !== "open_song"
              )
                throw new Error(
                  "Active song changed. Ask the writer to reopen the task song or explicitly open it.",
                );
              const args = { ...job.step.args };
              if (job.step.name === "create_song") {
                args.songId ??= `song-${job.step.id}`;
                args.operationId ??= job.step.id;
              }
              if (["import","bundle_import"].includes(job.step.name)) args.operationId ??= job.step.id;
              result = await executeTool(c, job.step.name, args);
            } catch (e) {
              result = {
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              };
            }
            checkpoint = { id: job.step.id, result };
            await save(c.db, "sessions", checkpoint);
          }
          await request("/result", {
            clientId,
            taskId: job.taskId,
            stepId: job.step.id,
            result: checkpoint.result,
          });
        } finally {
          inflight.delete(job.step.id);
        }
      }
    } catch {
      if (view.connected) {
        view.connected = false;
        c.notify();
      }
    } finally {
      if (!stopped) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void poll(), 1000);
      }
    }
  }
  return view;
}
