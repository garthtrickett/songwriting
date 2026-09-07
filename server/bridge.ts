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
import { TaskStore } from "./task-store.ts";
import type {
  Checkpoint,
  TaskSnapshot,
  TaskStatus,
} from "../src/agent/tasks.ts";
const statePath = join(folder, "tasks.json");
let initial: unknown = [];
try {
  initial = JSON.parse(await readFile(statePath, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT")
    throw new Error(`Cannot read task checkpoints: ${String(e)}`);
}
const store = new TaskStore(initial, async (tasks) => {
  await writeFile(statePath + ".tmp", JSON.stringify(tasks), { mode: 0o600 });
  await rename(statePath + ".tmp", statePath);
});
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
      const taskId = String(
        body.taskId ?? url.searchParams.get("taskId") ?? "",
      );
      const offset = Number(url.searchParams.get("offset") ?? 0),
        limit = Number(url.searchParams.get("limit") ?? 20);
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 50
      )
        throw new Error("Page offset/limit invalid");
      if (path === "/status")
        return response({
          connected: true,
          tasks: store.list(
            url.searchParams.get("clientId") ?? undefined,
            offset,
            limit,
          ),
        });
      if (path === "/task" && browser)
        return response(
          await store.create(
            String(body.clientId),
            body.songId ? String(body.songId) : null,
            String(body.prompt ?? ""),
            body.snapshot as TaskSnapshot | undefined,
          ),
        );
      if (path === "/control" && browser)
        return response(
          await store.control(
            String(body.id),
            String(body.clientId),
            body.action,
          ),
        );
      if (path === "/poll" && browser)
        return response(
          await store.poll(String(url.searchParams.get("clientId"))),
        );
      if (path === "/result" && browser)
        return response(
          await store.result(
            taskId,
            String(body.clientId),
            String(body.stepId),
            body.result,
          ),
        );
      if (!worker)
        return response({ error: "Agent authorization required" }, 403);
      if (path === "/tasks")
        return response(store.list(undefined, offset, limit));
      if (path === "/task_info")
        return response(store.info(taskId, offset, limit));
      if (path === "/claim")
        return response(
          await store.claim(
            taskId,
            String(body.provider ?? "external"),
            String(body.model ?? "unspecified"),
          ),
        );
      if (path === "/call") {
        const result = await store.call(
          taskId,
          String(body.stepId ?? crypto.randomUUID()),
          String(body.name),
          (body.args as Record<string, unknown>) ?? {},
        );
        return response(result, result.error ? 400 : 200);
      }
      if (path === "/step")
        return response(
          store.step(taskId, String(url.searchParams.get("stepId"))),
        );
      if (path === "/checkpoint")
        return response(
          await store.checkpoint(
            taskId,
            Number(body.expectedVersion),
            body.checkpoint as Omit<Checkpoint, "version" | "at">,
          ),
        );
      if (path === "/finish")
        return response(
          await store.finish(
            taskId,
            String(body.status) as TaskStatus,
            String(body.summary ?? ""),
          ),
        );
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
