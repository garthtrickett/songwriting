// Loopback-only external-agent host. Browser owns music; this host owns resumable task delivery.
import { mkdir, rename, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const folder = join(import.meta.dir, "../.agent");
await mkdir(folder, { recursive: true, mode: 0o700 });
const tokenPath = join(folder, "token");
let token: string;
try {
  token = (await readFile(tokenPath, "utf8")).trim();
} catch {
  token = crypto.randomUUID();
  await writeFile(tokenPath, token, { mode: 0o600 });
}
interface Step {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "pending" | "sent" | "done";
  result: unknown;
  sentAt: number;
}
interface Task {
  id: string;
  clientId: string;
  songId: string | null;
  prompt: string;
  status: string;
  summary: string;
  provider: string;
  model: string;
  createdAt: number;
  steps: Step[];
}
const statePath = join(folder, "tasks.json");
let tasks: Task[] = [];
try {
  tasks = JSON.parse(await readFile(statePath, "utf8")) as Task[];
} catch {}
let flush: Promise<void> = Promise.resolve();
const persist = () => {
  const data = JSON.stringify(tasks);
  flush = flush.then(async () => {
    await writeFile(statePath + ".tmp", data, { mode: 0o600 });
    await rename(statePath + ".tmp", statePath);
  });
  return flush;
};
const response = (data: unknown, status = 200) =>
  Response.json(data, { status });
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.SONGWRITING_BRIDGE_PORT ?? 5189),
  async fetch(req) {
    const url = new URL(req.url),
      path = url.pathname.replace(/^\/bridge/, "");
    const origin = req.headers.get("origin");
    if (
      origin &&
      !["http://127.0.0.1:5188", "http://localhost:5188"].includes(origin)
    )
      return response({ error: "Origin denied" }, 403);
    const browser = req.headers.get("x-songwriting-client") === "browser";
    const worker = req.headers.get("authorization") === `Bearer ${token}`;
    if (!worker && !browser)
      return response(
        { error: "Use the local agent CLI or connected editor" },
        401,
      );
    if (
      browser &&
      !origin &&
      req.headers.get("sec-fetch-site") !== "same-origin"
    )
      return response(
        { error: "Same-origin browser connection required" },
        403,
      );
    try {
      const body =
        req.method === "POST"
          ? ((await req.json()) as Record<string, unknown>)
          : {};
      if (path === "/status")
        return response({
          connected: true,
          tasks: tasks.filter(
            (t) =>
              !url.searchParams.get("clientId") ||
              t.clientId === url.searchParams.get("clientId"),
          ),
        });
      if (path === "/task" && browser) {
        const prompt = String(body.prompt ?? "").trim();
        if (!prompt) throw new Error("Task needs an objective");
        const task: Task = {
          id: crypto.randomUUID(),
          clientId: String(body.clientId),
          songId: body.songId ? String(body.songId) : null,
          prompt,
          status: "pending",
          summary: "Waiting for a coding agent to claim this task.",
          provider: "",
          model: "",
          createdAt: Date.now(),
          steps: [],
        };
        tasks.push(task);
        await persist();
        return response(task);
      }
      if (path === "/control" && browser) {
        const task = tasks.find((t) => t.id === body.id);
        if (!task || task.clientId !== body.clientId)
          throw new Error("Unknown task");
        if (body.action === "cancel") {
          task.status = "cancelled";
          task.summary =
            "Cancelled. Already committed edits remain available in change history.";
        } else {
          task.status = "pending";
          task.summary = "Resume requested. Agent must reread live song state.";
        }
        await persist();
        return response(task);
      }
      if (path === "/poll" && browser) {
        const clientId = url.searchParams.get("clientId");
        const pending = tasks
          .filter((t) => t.clientId === clientId && t.status === "running")
          .flatMap((t) =>
            t.steps
              .filter(
                (st) =>
                  st.status !== "done" &&
                  (st.status === "pending" || Date.now() - st.sentAt > 5000),
              )
              .map((st) => ({ taskId: t.id, songId: t.songId, step: st })),
          );
        for (const job of pending) {
          job.step.status = "sent";
          job.step.sentAt = Date.now();
        }
        if (pending.length) await persist();
        return response(pending);
      }
      if (path === "/result" && browser) {
        const task = tasks.find((t) => t.id === body.taskId);
        if (!task || task.clientId !== body.clientId)
          throw new Error("Unknown task");
        const step = task.steps.find((st) => st.id === body.stepId);
        if (!step) throw new Error("Unknown step");
        step.status = "done";
        step.result = body.result;
        await persist();
        return response({ saved: true });
      }
      if (!worker)
        return response({ error: "Agent authorization required" }, 403);
      if (path === "/tasks") return response(tasks);
      const task = tasks.find(
        (t) => t.id === body.taskId || t.id === url.searchParams.get("taskId"),
      );
      if (!task) throw new Error("Unknown task");
      if (path === "/claim") {
        if (task.status === "cancelled") throw new Error("Task cancelled");
        task.status = "running";
        task.provider = String(body.provider ?? "external");
        task.model = String(body.model ?? "unspecified");
        task.summary = "Agent connected. Working on the shared song.";
        await persist();
        return response(task);
      }
      if (path === "/call") {
        if (task.status !== "running")
          throw new Error(`Task is ${task.status}`);
        if (task.steps.length >= 100)
          throw new Error(
            "100 tool-call task limit reached. Checkpoint and request a new task.",
          );
        const id = String(body.stepId ?? crypto.randomUUID());
        const existing = task.steps.find((st) => st.id === id);
        if (existing) return response(existing);
        const step: Step = {
          id,
          name: String(body.name),
          args: (body.args as Record<string, unknown>) ?? {},
          status: "pending",
          result: null,
          sentAt: 0,
        };
        task.steps.push(step);
        await persist();
        return response(step);
      }
      if (path === "/step")
        return response(
          task.steps.find((st) => st.id === url.searchParams.get("stepId")) ??
            null,
        );
      if (path === "/finish") {
        const status = String(body.status);
        if (!["completed", "partial", "failed", "waiting"].includes(status))
          throw new Error("Explicit valid completion status required");
        if (task.status === "cancelled")
          throw new Error("Cannot finish cancelled task");
        if (task.steps.some((st) => st.status !== "done"))
          throw new Error("Resolve outstanding tool calls before completion");
        task.status = status;
        task.summary = String(body.summary ?? "");
        await persist();
        return response(task);
      }
      return response({ error: "Unknown bridge route" }, 404);
    } catch (e) {
      return response(
        { error: e instanceof Error ? e.message : String(e) },
        400,
      );
    }
  },
});
console.log(
  `Songwriting agent bridge: http://127.0.0.1:${server.port}. Credentials remain in .agent/token.`,
);
