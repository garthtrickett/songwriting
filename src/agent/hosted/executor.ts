import type { Controller } from '../../app/controller.ts';
import type { Envelope, Mutation } from '../../song/commands.ts';
import { read, save } from '../../storage/projects.ts';
import { executeTool } from '../tools.ts';
import { canonicalJson } from './canonical.ts';
import type { BrowserCommand, HostedTask, ToolReceipt } from './protocol.ts';
export interface Outbox { id: string; fingerprint: string; receipt: ToolReceipt; taskId: string; songId: string | null; commandId: string; generation: number; acknowledged?: boolean }
export function outboxId(owner: string, workspace: string, commandId: string) {
  return `hosted:${owner}:${workspace}:${commandId}`;
}
function mutationReceipt(envelope: Envelope, operationId: string): ToolReceipt {
  const effect = envelope.history.find(h => h.operationId === operationId);
  if (!effect) throw new Error('The saved operation receipt is missing.');
  return { ok: true, songId: envelope.id, revision: effect.revision, operationId,
    value: { saved: true, revision: effect.revision },
    effect: { songId: envelope.id, operationId, revision: effect.revision, label: effect.label,
      affectedTotal: effect.deltas.length, affected: effect.deltas.slice(0,20).map(d => ({table:d.table,id:d.id})) } };
}
export async function executeHosted(c: Controller, owner: string, task: HostedTask, active: () => boolean): Promise<Outbox> {
  const command = task.command;
  if (!command) throw new Error('No pending browser command.');
  const id = outboxId(owner, task.workspaceId, command.id);
  const saved = await read<Outbox>(c.db, 'sessions', id);
  if (saved) {
    if (saved.fingerprint !== command.fingerprint) throw new Error('Conflicting browser command identity.');
    return saved;
  }
  const delivery = {taskId:task.id,songId:task.songId,commandId:command.id,generation:command.generation};
  const eligible = () => active() && c.current?.id === task.songId && ['pending','running'].includes(task.status);
  let receipt: ToolReceipt;
  try {
    if (!eligible()) throw new Error('Reopen the task song and Resume to continue.');
    if (command.songId !== task.songId) throw new Error('Command belongs to a different song.');
    const args = JSON.parse(canonicalJson(command.args)) as Record<string, unknown>;
    if (command.name === 'mutate') {
      if (args.songId !== task.songId || args.operationId !== command.id || !Number.isSafeInteger(args.expectedRevision))
        throw new Error('Invalid mutation identity or revision.');
      const result = await c.mutate(args as unknown as Mutation, { active: eligible,
        receipt: e => ({ ...delivery, id, fingerprint: command.fingerprint, receipt: mutationReceipt(e, command.id) }) });
      if (!result.ok) throw new Error(result.error);
      const durable = await read<Outbox>(c.db, 'sessions', id);
      if (!durable) throw new Error('The tool delivery receipt was not saved.');
      return durable;
    }
    if (!['context','read'].includes(command.name)) throw new Error('Unsupported browser tool version.');
    await c.refresh();
    if (!eligible()) throw new Error('Active song changed.');
    let value: unknown;
    if (command.name === 'context') {
      // Initial context is scoped to the selected song, never the local songbook.
      value = { songId: c.current!.id, revision: c.current!.revision, title: c.song?.title,
        selection: c.selection, writing: c.song?.writing,
        counts: Object.fromEntries(Object.entries(c.song?.tables ?? {}).map(([name, rows]) => [name,Object.keys(rows).length])) };
    } else value = await executeTool(c, command.name, args);
    if (!eligible()) throw new Error('Active song changed while reading.');
    if (JSON.stringify(value).length > 32000) throw new Error('Result too large. Read one table/entity at a time.');
    receipt = { ok: true, value, songId: c.current!.id, revision: c.current!.revision };
  } catch (error) {
    // A UI subscriber can fail after the transaction committed. Preserve the
    // successful durable receipt rather than overwriting it with a render error.
    const committed=await read<Outbox>(c.db,'sessions',id);
    if(committed) {
      if(committed.fingerprint!==command.fingerprint)throw new Error('Conflicting browser command identity.');
      return committed;
    }
    receipt = { ok: false, error: (error instanceof Error ? error.message : 'Browser operation failed.').slice(0,2000),
      songId: task.songId, revision: c.current?.id === task.songId ? c.current.revision : null };
  }
  const record = { ...delivery, id, fingerprint: command.fingerprint, receipt };
  await save(c.db, 'sessions', record);
  return record;
}
export async function verifyCommand(command: BrowserCommand) {
  const bytes = new TextEncoder().encode(canonicalJson({name:command.name,args:command.args,songId:command.songId}));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if (hash !== command.fingerprint) throw new Error('Browser command fingerprint mismatch.');
}
