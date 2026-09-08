import type { HostedTask, BrowserCommand, ToolReceipt } from '../../src/agent/hosted/protocol.ts';
export interface CommandRecord extends BrowserCommand {
  toolCallId: string;
  runId: string;
  state: 'staged' | 'ready' | 'received' | 'consumed' | 'abandoned' | 'revoked';
  receipt?: ToolReceipt;
}
export interface TaskRecord {
  ownerId: string;
  requestId: string;
  view: HostedTask;
  runId: string;
  commands: CommandRecord[];
  lease: { generation: number; until: number };
  lastVerifiedRevision: number | null;
  lastMutationRevision: number | null;
  calls: number;
  reservedUsd: number;
  segmentStartedAt: number;
  rateLimitRetries?: number;
}
export interface Lease { taskId: string; ownerId: string; generation: number }
