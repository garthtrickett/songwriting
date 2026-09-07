export type TaskStatus =
  | "pending"
  | "running"
  | "waiting"
  | "partial"
  | "completed"
  | "failed"
  | "cancelled";
export interface WorkItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  note: string;
}
export interface Checkpoint {
  version: number;
  summary: string;
  nextStep: string;
  items: WorkItem[];
  at: number;
}
export interface TaskSnapshot {
  songId: string | null;
  revision: number | null;
  instructions: string;
  preferences: string;
  toolVersion: string;
}
export interface Effect {
  songId: string;
  operationId: string;
  revision: number;
  label: string;
  affected: { table: string; id: string }[];
  affectedTotal: number;
}
export interface Step {
  segment: number;
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "pending" | "sent" | "done";
  result: unknown;
  sentAt: number;
  effect: Effect | null;
  error: string;
}
export interface Task {
  id: string;
  clientId: string;
  songId: string | null;
  prompt: string;
  status: TaskStatus;
  summary: string;
  provider: string;
  model: string;
  createdAt: number;
  steps: Step[];
  snapshot: TaskSnapshot;
  checkpoint: Checkpoint;
  segment: number;
  segmentStart: number;
  segmentCalls: number;
  needsContext: boolean;
}
export type StepView = Pick<
  Step,
  "id" | "name" | "status" | "effect" | "error"
>;
export interface TaskView extends Omit<Task, "steps"> {
  steps: StepView[];
  stepCount: number;
}
export const stepView = (s: Step): StepView => ({
  id: s.id,
  name: s.name,
  status: s.status,
  effect: s.effect,
  error: s.error,
});
export const taskView = (t: Task): TaskView => ({
  ...t,
  steps: t.steps.slice(-10).map(stepView),
  stepCount: t.steps.length,
});
