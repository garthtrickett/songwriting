import type {
  Task,
  Step,
  Checkpoint,
  TaskSnapshot,
  TaskStatus,
} from "../src/agent/tasks.ts";
import { taskView, stepView } from "../src/agent/tasks.ts";
const text = (x: unknown, max: number, label: string) => {
  if (typeof x !== "string" || x.length > max)
    throw new Error(`Invalid ${label}`);
  return x;
};
const id = (x: unknown) => {
  const s = text(x, 100, "identity");
  if (!s) throw new Error("Identity required");
  return s;
};
const blankCheckpoint = (): Checkpoint => ({
  version: 0,
  summary: "",
  nextStep: "",
  items: [],
  at: 0,
});
const blankSnapshot = (songId: string | null): TaskSnapshot => ({
  songId,
  revision: null,
  instructions: "",
  preferences: "",
  toolVersion: "legacy",
});
export class TaskStore {
  private rows: Task[];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    initial: unknown,
    private save: (tasks: Task[]) => Promise<void>,
    private now = () => Date.now(),
  ) {
    if (!Array.isArray(initial))
      throw new Error("Invalid task checkpoint file");
    this.rows = initial.map((raw) => {
      if (
        !raw ||
        typeof raw.id !== "string" ||
        !Array.isArray(raw.steps) ||
        typeof raw.prompt !== "string"
      )
        throw new Error("Invalid stored task");
      return {
        ...raw,
        ...(raw.status === "running"
          ? {
              status: "waiting",
              summary:
                "Host restarted. Progress retained; resume and refresh live context.",
            }
          : {}),
        snapshot: raw.snapshot ?? blankSnapshot(raw.songId),
        checkpoint: raw.checkpoint ?? blankCheckpoint(),
        segment: raw.segment ?? 0,
        segmentCalls: raw.segmentCalls ?? 0,
        segmentStart: raw.segmentStart ?? 0,
        needsContext: raw.status === "running" || raw.needsContext === true,
        steps: raw.steps.map((s: Step) => ({
          ...s,
          segment: s.segment ?? 0,
          effect: s.effect ?? null,
          error: s.error ?? "",
        })),
      };
    });
  }
  private change<T>(fn: (rows: Task[]) => T): Promise<T> {
    const job = this.queue.then(async () => {
      const next = structuredClone(this.rows),
        result = fn(next);
      await this.save(next);
      this.rows = next;
      return structuredClone(result);
    });
    this.queue = job.catch(() => {});
    return job;
  }
  private get(rows: Task[], taskId: unknown) {
    const t = rows.find((t) => t.id === taskId);
    if (!t) throw new Error("Unknown task");
    return t;
  }
  list(clientId?: string, offset = 0, limit = 50) {
    return this.rows
      .filter((t) => !clientId || t.clientId === clientId)
      .slice()
      .reverse()
      .slice(offset, offset + limit)
      .reverse()
      .map(taskView);
  }
  info(taskId: string, offset = 0, limit = 20) {
    const t = this.get(this.rows, taskId);
    return {
      ...taskView(t),
      steps: t.steps.slice(offset, offset + limit).map(stepView),
      nextOffset: offset + limit < t.steps.length ? offset + limit : null,
    };
  }
  step(taskId: string, stepId: string) {
    return structuredClone(
      this.get(this.rows, taskId).steps.find((s) => s.id === stepId) ?? null,
    );
  }
  create(
    clientId: string,
    songId: string | null,
    prompt: string,
    snapshot?: TaskSnapshot,
  ) {
    return this.change((rows) => {
      const p = text(prompt.trim(), 8000, "objective");
      if (!p) throw new Error("Task needs an objective");
      const snap = snapshot ?? blankSnapshot(songId);
      text(snap.instructions, 8000, "instructions");
      text(snap.preferences, 4000, "preferences");
      text(snap.toolVersion, 100, "tool version");
      if (
        snap.songId !== songId ||
        !(
          snap.revision === null ||
          (Number.isSafeInteger(snap.revision) && snap.revision >= 0)
        )
      )
        throw new Error("Invalid task source snapshot");
      const t: Task = {
        id: crypto.randomUUID(),
        clientId: id(clientId),
        songId,
        prompt: p,
        status: "pending",
        summary: "Waiting for a coding agent to claim this task.",
        provider: "",
        model: "",
        createdAt: this.now(),
        steps: [],
        snapshot: snap,
        checkpoint: blankCheckpoint(),
        segment: 0,
        segmentStart: 0,
        segmentCalls: 0,
        needsContext: false,
      };
      rows.push(t);
      return taskView(t);
    });
  }
  control(taskId: string, clientId: string, action: unknown) {
    return this.change((rows) => {
      const t = this.get(rows, taskId);
      if (t.clientId !== clientId) throw new Error("Unknown task");
      if (action === "cancel") {
        t.status = "cancelled";
        t.summary =
          "Cancelled. Already committed edits remain available in change history.";
      } else if (action === "resume") {
        if (t.status === "running" || t.status === "pending")
          throw new Error("Task is already active");
        if (t.steps.length >= 1000)
          throw new Error(
            "Task reached 1,000 calls; create a new task with this checkpoint",
          );
        t.status = "pending";
        t.needsContext = true;
        t.summary =
          "Resume requested. A fresh context result is required before further tools.";
      } else throw new Error("Unknown task control");
      return taskView(t);
    });
  }
  claim(taskId: string, provider: string, model: string) {
    return this.change((rows) => {
      const t = this.get(rows, taskId);
      if (t.status !== "pending")
        throw new Error(
          `Task is ${t.status}; explicitly resume before claiming again`,
        );
      t.status = "running";
      t.provider = text(provider, 100, "provider");
      t.model = text(model, 200, "model");
      t.segment++;
      t.segmentStart = this.now();
      t.segmentCalls = 0;
      t.needsContext = t.needsContext || t.segment > 1;
      t.summary = t.needsContext
        ? "Resuming: refresh live context and reconcile committed operations."
        : "Agent connected. Working on the shared song.";
      return taskView(t);
    });
  }
  call(
    taskId: string,
    stepId: string,
    name: string,
    args: Record<string, unknown>,
  ) {
    return this.change((rows) => {
      const t = this.get(rows, taskId),
        existing = t.steps.find((s) => s.id === stepId);
      if (existing) {
        if (
          existing.name !== name ||
          JSON.stringify(existing.args) !== JSON.stringify(args)
        )
          throw new Error("Step identity reused with different arguments");
        return existing;
      }
      if (t.status !== "running") throw new Error(`Task is ${t.status}`);
      if (
        t.segmentCalls >= 100 ||
        t.steps.length >= 1000 ||
        this.now() - t.segmentStart >= 15 * 60 * 1000
      ) {
        t.status = "waiting";
        t.summary =
          "Execution limit reached. Progress retained; resume explicitly for another segment.";
        t.needsContext = true;
        return { error: t.summary };
      }
      if (t.needsContext && !["context", "schema", "open_song"].includes(name))
        throw new Error(
          "Resume requires a newly delivered context result before further tools",
        );
      if (!args || typeof args !== "object" || Array.isArray(args))
        throw new Error("Tool arguments must be an object");
      const s: Step = {
        segment: t.segment,
        id: id(stepId),
        name: text(name, 100, "tool name"),
        args,
        status: "pending",
        result: null,
        sentAt: 0,
        effect: null,
        error: "",
      };
      t.steps.push(s);
      t.segmentCalls++;
      return s;
    });
  }
  async poll(clientId: string) {
    if (
      this.rows.some(
        (t) =>
          t.clientId === clientId &&
          t.status === "running" &&
          this.now() - t.segmentStart >= 15 * 60 * 1000,
      )
    )
      await this.change((rows) => {
        for (const t of rows)
          if (
            t.clientId === clientId &&
            t.status === "running" &&
            this.now() - t.segmentStart >= 15 * 60 * 1000
          ) {
            t.status = "waiting";
            t.needsContext = true;
            t.summary =
              "Execution time limit reached. Pending work retained; resume explicitly.";
          }
      });
    // No write is necessary when no deliveries are due.
    const due = (t: Task, s: Step) =>
      t.clientId === clientId &&
      t.status === "running" &&
      s.status !== "done" &&
      (!t.needsContext ||
        (s.segment === t.segment &&
          ["context", "schema", "open_song"].includes(s.name))) &&
      (s.status === "pending" || this.now() - s.sentAt > 5000);
    if (!this.rows.some((t) => t.steps.some((s) => due(t, s)))) return [];
    return this.change((rows) =>
      rows.flatMap((t) =>
        t.steps
          .filter((s) => due(t, s))
          .map((s) => {
            s.status = "sent";
            s.sentAt = this.now();
            return { taskId: t.id, songId: t.songId, step: s };
          }),
      ),
    );
  }
  result(taskId: string, clientId: string, stepId: string, result: unknown) {
    return this.change((rows) => {
      const t = this.get(rows, taskId);
      if (t.clientId !== clientId) throw new Error("Unknown task");
      const s = t.steps.find((s) => s.id === stepId);
      if (!s) throw new Error("Unknown step");
      if (s.status === "done") return { saved: true };
      s.status = "done";
      s.result = result;
      const r = result as any;
      s.error =
        r?.ok === false ? String(r.error ?? "Tool failed").slice(0, 500) : "";
      if (
        s.name === "context" &&
        s.segment === t.segment &&
        !s.error &&
        r &&
        ((Number.isSafeInteger(r.revision) && r.songId === t.songId) ||
          (!t.songId && !r.songId))
      )
        t.needsContext = false;
      if (
        ["open_song", "create_song", "import", "bundle_import"].includes(
          s.name,
        ) &&
        !s.error
      ) {
        const songId = r?.value?.song?.id ?? r?.songId;
        if (typeof songId === "string") t.songId = songId;
      }
      const operationId = s.args.operationId ?? s.id,
        h =
          r?.ok === true &&
          r.value?.history?.find((h: any) => h.operationId === operationId);
      if (h)
        s.effect = {
          songId: r.value.id,
          operationId: h.operationId,
          revision: h.revision,
          label: String(h.label).slice(0, 200),
          affected: h.deltas
            .slice(0, 20)
            .map((d: any) => ({ table: d.table, id: d.id })),
          affectedTotal: h.deltas.length,
        };
      return { saved: true };
    });
  }
  checkpoint(
    taskId: string,
    expectedVersion: number,
    input: Omit<Checkpoint, "version" | "at">,
  ) {
    return this.change((rows) => {
      const t = this.get(rows, taskId);
      if (!["running", "waiting", "partial", "failed"].includes(t.status))
        throw new Error("Task is not checkpointable");
      if (expectedVersion !== t.checkpoint.version)
        throw new Error("Checkpoint version conflict");
      text(input.summary, 8000, "checkpoint summary");
      text(input.nextStep, 2000, "next step");
      if (!Array.isArray(input.items) || input.items.length > 50)
        throw new Error("At most 50 work items");
      const ids = new Set<string>();
      for (const item of input.items) {
        id(item.id);
        if (ids.has(item.id)) throw new Error("Duplicate work item");
        ids.add(item.id);
        text(item.title, 200, "work item title");
        text(item.note, 1000, "work item note");
        if (
          ![
            "pending",
            "in_progress",
            "completed",
            "failed",
            "skipped",
          ].includes(item.status)
        )
          throw new Error("Invalid work item status");
      }
      t.checkpoint = { ...input, version: expectedVersion + 1, at: this.now() };
      return taskView(t);
    });
  }
  finish(taskId: string, status: TaskStatus, summary: string) {
    return this.change((rows) => {
      const t = this.get(rows, taskId);
      if (
        !["completed", "partial", "failed", "waiting"].includes(status) ||
        t.status === "cancelled"
      )
        throw new Error("Explicit valid completion state required");
      if (t.steps.some((s) => s.status !== "done"))
        throw new Error("Resolve outstanding tool calls before completion");
      if (
        status === "completed" &&
        (t.needsContext ||
          t.checkpoint.items.some(
            (i) => !["completed", "skipped"].includes(i.status),
          ))
      )
        throw new Error(
          "Refresh context and resolve unfinished work items before completion",
        );
      t.status = status;
      t.summary = text(summary, 8000, "completion summary");
      return taskView(t);
    });
  }
}
