import { z } from "zod";

export const PROTOCOL = 1;
export const identity = z.string().min(1).max(100);
export const jsonObject = z.record(z.string(), z.unknown());
export const bindingSchema = z.object({
  workspaceId: identity, songId: identity.nullable(),
});
export const snapshotSchema = z.object({
  songId: identity.nullable(), revision: z.number().int().nonnegative().nullable(),
  instructions: z.string().max(8000), preferences: z.string().max(4000),
  toolVersion: z.string().max(100),
});
export const taskRequestSchema = bindingSchema.extend({
  protocol: z.literal(PROTOCOL), requestId: z.uuid(), prompt: z.string().trim().min(1).max(8000),
  snapshot: snapshotSchema,
});
export const commandSchema = z.object({
  id: identity, name: identity, args: jsonObject, songId: identity.nullable(),
  fingerprint: z.string(), generation: z.number().int().nonnegative(),
});
export type BrowserCommand = z.infer<typeof commandSchema>;
export const messageSchema = z.object({
  id: identity, role: z.enum(["user", "assistant"]), text: z.string().max(16000),
});
export const hostedTaskSchema = z.object({
  protocol: z.literal(PROTOCOL), id: z.uuid(), workspaceId: identity, songId: identity.nullable(),
  prompt: z.string(), status: z.enum(["pending", "running", "waiting", "partial", "completed", "failed", "cancelled"]),
  summary: z.string(), model: z.string(), createdAt: z.number(), version: z.number().int(),
  snapshot: snapshotSchema, messages: z.array(messageSchema),
  command: commandSchema.nullable(), question: z.string().nullable(),
  stepCount: z.number().int(), segment: z.number().int(), segmentCalls: z.number().int(),
  needsContext: z.boolean(),
  nextAttemptAt: z.number().nonnegative().optional(),
  checkpoint: z.object({ version: z.number().int(), summary: z.string(), nextStep: z.string(), at: z.number(),
    items: z.array(z.object({ id: identity, title: z.string().max(200),
      status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]), note: z.string().max(1000) })).max(50) }),
  steps: z.array(z.object({ id: identity, name: z.string(), status: z.enum(["pending", "sent", "done"]),
    error: z.string(), effect: z.object({ songId: identity, operationId: identity, revision: z.number(),
      label: z.string(), affectedTotal: z.number(), affected: z.array(z.object({ table: z.string(), id: identity })) }).nullable() })),
});
export type HostedTask = z.infer<typeof hostedTaskSchema>;
export type TaskRequest = z.infer<typeof taskRequestSchema>;
export const receiptSchema = z.object({
  ok: z.boolean(), error: z.string().max(2000).optional(), value: z.unknown().optional(),
  songId: identity.nullable(), revision: z.number().int().nonnegative().nullable(),
  operationId: identity.optional(), effect: hostedTaskSchema.shape.steps.element.shape.effect.optional(),
});
export type ToolReceipt = z.infer<typeof receiptSchema>;
export const resultRequestSchema = bindingSchema.extend({
  protocol: z.literal(PROTOCOL), commandId: identity, fingerprint: z.string(), generation: z.number().int(), receipt: receiptSchema,
});
export const taskListSchema = z.object({ protocol: z.literal(PROTOCOL), tasks: z.array(hostedTaskSchema) });
