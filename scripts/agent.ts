import { readFile } from "node:fs/promises";
const token = (
  await readFile(new URL("../.agent/token", import.meta.url), "utf8")
).trim();
const base =
  process.env.SONGWRITING_BRIDGE_URL ?? "http://127.0.0.1:5189/bridge";
async function api(path: string, data?: unknown) {
  const r = await fetch(base + path, {
    headers: {
      authorization: `Bearer ${token}`,
      ...(data ? { "content-type": "application/json" } : {}),
    },
    ...(data ? { method: "POST", body: JSON.stringify(data) } : {}),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(result));
  return result;
}
const [action, taskId, ...rest] = process.argv.slice(2);
if (action === "tasks")
  console.log(JSON.stringify(await api("/tasks"), null, 2));
else if (action === "claim")
  console.log(
    JSON.stringify(
      await api("/claim", { taskId, provider: rest[0], model: rest[1] }),
      null,
      2,
    ),
  );
else if (action === "call") {
  const [name, file] = rest;
  const args = file
    ? JSON.parse(
        file === "-" ? await Bun.stdin.text() : await readFile(file, "utf8"),
      )
    : {};
  const step = (await api("/call", {
    taskId,
    name,
    args,
    stepId: crypto.randomUUID(),
  })) as { id: string };
  const deadline = Date.now() + 45000;
  let done = false;
  while (Date.now() < deadline) {
    const result = (await api(`/step?taskId=${taskId}&stepId=${step.id}`)) as {
      status: string;
      result: unknown;
    };
    if (result.status === "done") {
      console.log(JSON.stringify(result.result, null, 2));
      done = true;
      break;
    }
    await Bun.sleep(200);
  }
  if (!done) {
    console.log(
      JSON.stringify({
        pending: true,
        taskId,
        stepId: step.id,
        message: "Keep the task browser open. Query this step before retrying.",
      }),
    );
    process.exitCode = 2;
  }
} else if (action === "step")
  console.log(
    JSON.stringify(
      await api(`/step?taskId=${taskId}&stepId=${rest[0]}`),
      null,
      2,
    ),
  );
else if (action === "finish")
  console.log(
    JSON.stringify(
      await api("/finish", {
        taskId,
        status: rest[0],
        summary: rest.slice(1).join(" "),
      }),
      null,
      2,
    ),
  );
else
  throw new Error(
    "Usage: bun run agent tasks | claim TASK PROVIDER MODEL | call TASK TOOL [args.json|-] | step TASK STEP | finish TASK completed|partial|failed|waiting SUMMARY",
  );
