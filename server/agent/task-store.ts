import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { TaskRequest, HostedTask, ToolReceipt } from '../../src/agent/hosted/protocol.ts';
import { PROTOCOL } from '../../src/agent/hosted/protocol.ts';
import { canonicalJson } from '../../src/agent/hosted/canonical.ts';
import type { CommandRecord, Lease, TaskRecord } from './types.ts';
const terminal = (t: TaskRecord) => ['completed', 'cancelled'].includes(t.view.status);
export const fingerprint = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export class TaskStore {
  constructor(readonly pool: Pool, readonly model: string, private now = () => Date.now()) {}
  private async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
    catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }
  private async load(db: PoolClient | Pool, owner: string, id: string, lock = false): Promise<TaskRecord> {
    const { rows } = await db.query(`SELECT record FROM songwriting_agent.tasks WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, owner]);
    if (!rows[0]) throw new Error('Task not found');
    return rows[0].record;
  }
  private async save(db: PoolClient, t: TaskRecord) {
    t.view.version++;
    t.view.command = t.commands.find(c => c.state === 'ready') ?? null;
    t.view.stepCount = t.commands.length;
    await db.query('UPDATE songwriting_agent.tasks SET record=$1, updated_at=now() WHERE id=$2 AND owner_id=$3', [JSON.stringify(t), t.view.id, t.ownerId]);
  }
  async update<T>(owner: string, id: string, fn: (t: TaskRecord, db: PoolClient) => T | Promise<T>, lease?: Lease): Promise<T> {
    return this.transaction(async db => {
      const t = await this.load(db, owner, id, true);
      if (lease && (t.lease.generation !== lease.generation || t.lease.until <= this.now() || terminal(t)))
        throw new Error('Agent execution lease expired');
      const result = await fn(t,db);
      await this.save(db, t); return structuredClone(result);
    });
  }
  async create(owner: string, input: TaskRequest): Promise<HostedTask> {
    if (input.snapshot.songId !== input.songId) throw new Error('Task snapshot must match the song');
    return this.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${owner}:${input.workspaceId}`]);
      const old = await db.query('SELECT record FROM songwriting_agent.tasks WHERE owner_id=$1 AND request_id=$2', [owner, input.requestId]);
      if (old.rows[0]) {
        const t: TaskRecord = old.rows[0].record;
        if (t.view.prompt !== input.prompt || t.view.workspaceId !== input.workspaceId || t.view.songId !== input.songId || canonicalJson(t.view.snapshot) !== canonicalJson(input.snapshot))
          throw new Error('Request identity reused with different content');
        return t.view;
      }
      const active = await db.query("SELECT id FROM songwriting_agent.tasks WHERE owner_id=$1 AND workspace_id=$2 AND record->'view'->>'status' IN ('pending','running','waiting')", [owner,input.workspaceId]);
      if (active.rowCount) throw new Error('Stop or finish the current task before sending another request');
      const now = this.now(), id = randomUUID();
      const view: HostedTask = {
        protocol: PROTOCOL, id, workspaceId: input.workspaceId, songId: input.songId,
        prompt: input.prompt, status: 'pending', summary: 'Ready to read your song.', model: this.model,
        createdAt: now, version: 0, snapshot: input.snapshot,
        messages: [{ id: randomUUID(), role: 'user', text: input.prompt }], command: null, question: null,
        stepCount: 0, segment: 1, segmentCalls: 0, needsContext: true,
        checkpoint: { version: 0, summary: '', nextStep: '', at: now, items: [] }, steps: [],
      };
      const t: TaskRecord = { ownerId: owner, requestId: input.requestId, view, runId: randomUUID(), commands: [],
        lease: { generation: 0, until: 0 }, lastVerifiedRevision: null, lastMutationRevision: null,
        calls: 0, reservedUsd: 0, segmentStartedAt: now };
      await db.query('INSERT INTO songwriting_agent.tasks(id,owner_id,workspace_id,request_id,record) VALUES($1,$2,$3,$4,$5)',
        [id,owner,input.workspaceId,input.requestId,JSON.stringify(t)]);
      return view;
    });
  }
  get(owner: string, id: string) { return this.load(this.pool, owner, id); }
  async list(owner: string, workspace: string) {
    const { rows } = await this.pool.query('SELECT record FROM songwriting_agent.tasks WHERE owner_id=$1 AND workspace_id=$2 ORDER BY updated_at DESC LIMIT 30', [owner,workspace]);
    return rows.map(r => (r.record as TaskRecord).view);
  }
  async acquire(owner: string, id: string): Promise<Lease> {
    return this.update(owner, id, t => {
      if (terminal(t) || ['waiting','failed','partial'].includes(t.view.status)) throw new Error('Task needs explicit Resume');
      if (t.lease.until > this.now()) throw new Error('Agent is already working');
      if (t.lease.until !== 0) {
        // An expired worker may still flush SDK state. Never reuse its run/thread.
        t.runId = randomUUID(); t.view.needsContext = true;
        for (const c of t.commands) if (c.state === 'staged') c.state = 'abandoned';
      }
      t.lease = { generation: t.lease.generation + 1, until: this.now() + 55000 };
      t.view.status = 'running';
      delete t.view.nextAttemptAt;
      return { taskId: id, ownerId: owner, generation: t.lease.generation };
    });
  }
  async reserve(lease: Lease, dollars: number, taskLimit: number, dailyLimit: number) {
    return this.transaction(async db => {
      const t = await this.load(db, lease.ownerId, lease.taskId, true);
      if (t.lease.generation !== lease.generation || t.lease.until <= this.now() || terminal(t)) throw new Error('Agent execution lease expired');
      if (t.view.segmentCalls >= 100 || t.calls >= 1000 || this.now() - t.segmentStartedAt >= 15 * 60 * 1000)
        throw new Error('Execution limit reached. Resume to continue from saved progress.');
      await db.query('INSERT INTO songwriting_agent.usage(owner_id,day) VALUES($1,CURRENT_DATE) ON CONFLICT DO NOTHING', [lease.ownerId]);
      const usage = await db.query('SELECT reserved_usd FROM songwriting_agent.usage WHERE owner_id=$1 AND day=CURRENT_DATE FOR UPDATE', [lease.ownerId]);
      if (t.reservedUsd + dollars > taskLimit || Number(usage.rows[0].reserved_usd) + dollars > dailyLimit)
        throw new Error('Agent usage budget reached. Saved edits are retained.');
      await db.query('UPDATE songwriting_agent.usage SET reserved_usd=reserved_usd+$2,calls=calls+1 WHERE owner_id=$1 AND day=CURRENT_DATE', [lease.ownerId,dollars]);
      t.reservedUsd += dollars; t.calls++; t.view.segmentCalls++;
      await this.save(db,t);
      const id=randomUUID();
      await db.query('INSERT INTO songwriting_agent.charges(id,task_id,owner_id,reserved_usd) VALUES($1,$2,$3,$4)',
        [id,lease.taskId,lease.ownerId,dollars]);
      return id;
    });
  }
  async settle(owner:string, id:string, actual:number) {
    if(!Number.isFinite(actual) || actual<0) throw new Error('Invalid usage accounting');
    await this.transaction(async db=>{
      const result=await db.query('SELECT * FROM songwriting_agent.charges WHERE id=$1 AND owner_id=$2',[id,owner]);
      if(!result.rows[0]) throw new Error('Unknown model charge');
      const t=await this.load(db,owner,result.rows[0].task_id,true);
      const {rows}=await db.query('SELECT * FROM songwriting_agent.charges WHERE id=$1 FOR UPDATE',[id]);
      const charge=rows[0];
      if(charge.actual_usd!==null)return;
      const delta=actual-Number(charge.reserved_usd);
      await db.query('UPDATE songwriting_agent.charges SET actual_usd=$2 WHERE id=$1',[id,actual]);
      await db.query('UPDATE songwriting_agent.usage SET reserved_usd=reserved_usd+$3 WHERE owner_id=$1 AND day=$2',[owner,charge.day,delta]);
      t.reservedUsd=Math.max(0,t.reservedUsd+delta);await this.save(db,t);
    });
  }
  async stage(lease: Lease, toolCallId: string, name: string, input: Record<string, unknown>) {
    return this.update(lease.ownerId, lease.taskId, t => {
      const old = t.commands.find(c => c.runId === t.runId && c.toolCallId === toolCallId);
      const id = fingerprint([t.view.id,t.runId,toolCallId]).slice(0,48);
      const args = name === 'mutate' ? { ...input, songId: t.view.songId, operationId: id } : input;
      const hash = fingerprint({ name, args, songId: t.view.songId });
      if (old) {
        if (old.fingerprint !== hash) throw new Error('Tool call identity reused');
        return old;
      }
      if (t.view.needsContext && name !== 'context') throw new Error('Read fresh context before using other tools');
      const command: CommandRecord = { id, name, args, songId: t.view.songId, fingerprint: hash,
        generation: lease.generation, runId: t.runId, toolCallId, state: 'staged' };
      t.commands.push(command);
      if (t.commands.length > 1000) throw new Error('Task tool limit reached');
      return command;
    }, lease);
  }
  async publish(lease: Lease, pendingIds: string[]) {
    await this.update(lease.ownerId, lease.taskId, t => {
      for (const c of t.commands) {
        if (pendingIds.includes(c.id) && c.state === 'staged') c.state = 'ready';
        if (!pendingIds.includes(c.id) && c.state === 'received') c.state = 'consumed';
      }
      t.view.summary = 'Working with the open song.';
    },lease);
  }
  async receive(owner: string, id: string, workspace: string, songId: string | null, commandId: string, hash: string, receipt: ToolReceipt) {
    return this.update(owner,id,t => {
      if (t.view.workspaceId !== workspace || t.view.songId !== songId) throw new Error('Task workspace changed');
      const c = t.commands.find(c => c.id === commandId);
      if (!c || c.fingerprint !== hash) throw new Error('Unknown command receipt');
      if (c.receipt) {
        if (canonicalJson(c.receipt) !== canonicalJson(receipt)) throw new Error('Conflicting duplicate tool result');
        return;
      }
      if (!['ready','revoked'].includes(c.state)) throw new Error('Command is not deliverable');
      c.receipt = receipt; c.state = 'received';
      if (!receipt.ok) t.view.needsContext = true;
      if (receipt.ok && receipt.songId === t.view.songId && c.runId === t.runId) {
        if (c.name === 'context') { t.view.needsContext = false; t.lastVerifiedRevision = receipt.revision; }
        if (c.name === 'read') t.lastVerifiedRevision = receipt.revision;
        if (c.name === 'mutate') { t.lastMutationRevision = receipt.revision; t.lastVerifiedRevision = null; }
      }
      if (c.runId !== t.runId && c.name === 'mutate' && receipt.ok &&
        (t.lastVerifiedRevision===null || receipt.revision===null || receipt.revision>t.lastVerifiedRevision)) {
        t.lastMutationRevision = receipt.revision; t.lastVerifiedRevision = null; t.view.needsContext = true;
        if(t.view.status==='completed') {
          t.view.status='partial';t.view.summary='A late saved edit needs verification. Resume to check the current song.';
        }
      }
      t.view.steps.push({ id: c.id, name:c.name,status:'done',error:receipt.error ?? '',effect:receipt.effect ?? null });
      t.view.steps = t.view.steps.slice(-10);
    });
  }
  async finish(lease: Lease, summary: string) {
    await this.update(lease.ownerId, lease.taskId, t => {
      if (t.commands.some(c => c.state === 'ready' || c.state === 'staged')) throw new Error('Browser commands are unfinished');
      if (t.view.needsContext || t.lastVerifiedRevision === null || (t.lastMutationRevision !== null && t.lastVerifiedRevision < t.lastMutationRevision))
        throw new Error('Read and verify the saved song before completing');
      if (t.view.checkpoint.items.some(i => !['completed','skipped'].includes(i.status))) throw new Error('Work items are unfinished');
      t.view.status = 'completed'; t.view.summary = summary;
      t.view.messages.push({ id:randomUUID(),role:'assistant',text:summary });
      t.lease.until = 0;
    },lease);
  }
  async release(lease: Lease, text?: string, error?: string) {
    await this.update(lease.ownerId,lease.taskId,t => {
      if (t.lease.generation !== lease.generation) return;
      t.lease.until = 0;
      if (!terminal(t)) {
        if (text) t.view.messages.push({id:randomUUID(),role:'assistant',text:text.slice(0,16000)});
        if (error) {t.view.status='partial';t.view.summary=error.slice(0,2000);}
      }
      t.view.messages=t.view.messages.slice(-30);
    });
  }
  async deferRateLimit(lease:Lease) {
    await this.update(lease.ownerId,lease.taskId,t=>{
      t.rateLimitRetries=(t.rateLimitRetries??0)+1;
      t.lease.until=0;
      if(t.rateLimitRetries<=2) {
        t.view.nextAttemptAt=this.now()+60000;
        t.view.summary='The model is busy. Retrying in one minute; saved edits are retained.';
      } else {
        t.view.status='partial';
        t.view.summary='The model is still rate-limited. Saved edits are retained. Resume later to continue.';
      }
    },lease);
  }
  async control(owner: string, id: string, workspace: string, action: 'cancel' | 'resume') {
    await this.update(owner,id,async(t,db)=>{
      if(t.view.workspaceId !== workspace) throw new Error('Wrong workspace');
      if(action==='cancel') {
        delete t.view.nextAttemptAt;
        for (const c of t.commands) {
          if (c.state === 'ready') c.state = 'revoked';
          if (c.state === 'staged') c.state = 'abandoned';
        }
        t.view.status='cancelled';t.view.summary='Stopped. Saved changes remain available to undo.';t.lease={generation:t.lease.generation+1,until:0};return;
      }
      if(t.view.status==='completed') throw new Error('Start a new task to change completed work');
      if(t.lease.until>this.now()) throw new Error('Agent is still working');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${owner}:${workspace}`]);
      const active=await db.query("SELECT id FROM songwriting_agent.tasks WHERE owner_id=$1 AND workspace_id=$2 AND id<>$3 AND record->'view'->>'status' IN ('pending','running','waiting')",[owner,workspace,id]);
      if(active.rowCount)throw new Error('Stop or finish the current task before sending another request');
      t.runId=randomUUID();
      delete t.view.nextAttemptAt;t.rateLimitRetries=0;
      for (const c of t.commands) {
        if(c.state==='ready') c.state='revoked';
        if(c.state==='staged') c.state='abandoned';
        if(c.state==='received') c.state='consumed';
      }
      t.view.status='pending';t.view.needsContext=true;t.view.segment++;t.view.segmentCalls=0;t.segmentStartedAt=this.now();
      t.view.summary='Resuming with fresh song context.';
    });
  }
}
