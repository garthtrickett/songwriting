import { randomUUID } from 'node:crypto';
import type { PostgresStore } from '@mastra/pg';
import { songwritingAgent } from '../mastra/songwriting.ts';
import type { TaskStore } from './task-store.ts';
import type { Lease } from './types.ts';
import { meterModel, type StreamingModel } from './meter.ts';
export interface RuntimeLimits { reservationUsd: number; taskUsd: number; dailyUsd: number }
export class AgentRuntime {
  constructor(private store: TaskStore, private storage: PostgresStore, private model: StreamingModel,
    private limits: RuntimeLimits = { reservationUsd: 0.2, taskUsd: 1, dailyUsd: 5 },
    private prices?: {input:number;output:number}) {}
  async advance(owner: string, id: string, onText: (text: string) => void = () => {}) {
    const current = await this.store.get(owner,id);
    if (!['pending','running'].includes(current.view.status)) return current.view;
    if ((current.view.nextAttemptAt??0)>Date.now()) return current.view;
    if (current.view.command) return current.view;
    if (current.lease.until > Date.now()) return current.view;
    const lease = await this.store.acquire(owner,id);
    try { await this.run(lease,onText); }
    catch(error) {
      const message=error instanceof Error?error.message:typeof error==='string'?error:'Agent request failed';
      if(/rate.limit/i.test(message))await this.store.deferRateLimit(lease);
      else await this.store.release(lease,undefined,message);
    }
    return (await this.store.get(owner,id)).view;
  }
  private async run(lease: Lease, onText: (text: string) => void) {
    const metered=meterModel(this.model,async()=>{
      const charge=await this.store.reserve(lease,this.limits.reservationUsd,this.limits.taskUsd,this.limits.dailyUsd);
      return async usage=>{
        if(this.prices) await this.store.settle(lease.ownerId,charge,
          usage.inputTokens*this.prices.input+usage.outputTokens*this.prices.output);
      };
    });
    try { await this.runModel(lease,onText,metered.model); }
    finally { await metered.finished(); }
  }
  private async runModel(lease: Lease, onText: (text: string) => void, model:StreamingModel) {
    let task = await this.store.get(lease.ownerId,lease.taskId);
    let agent = songwritingAgent(this.store,this.storage,model,lease,task);
    const { runs } = await agent.listSuspendedRuns({ threadId:task.runId,resourceId:task.ownerId });
    const suspended = runs.find(r=>r.runId===task.runId);
    if(suspended) {
      const ids = suspended.toolCalls.map(c => (c.suspendPayload as {commandId?:string})?.commandId).filter((id):id is string=>typeof id==='string');
      await this.store.publish(lease,ids);
      task = await this.store.get(lease.ownerId,lease.taskId);
      if(task.commands.some(c=>ids.includes(c.id) && c.state==='ready')) { await this.store.release(lease);return; }
    } else if(task.commands.some(c=>c.state==='staged'||c.state==='received')) {
      // No browser effect is released without a recoverable suspension. Rebuild an
      // interrupted model segment from receipts; never regenerate committed edits.
      await this.store.update(lease.ownerId,lease.taskId,t=>{
        for(const c of t.commands) {
          if(c.state==='staged') c.state='abandoned';
          if(c.state==='received') c.state='consumed';
        }
        t.runId=randomUUID();t.view.needsContext=true;
      },lease);
      task=await this.store.get(lease.ownerId,lease.taskId);
      agent=songwritingAgent(this.store,this.storage,model,lease,task);
    }
    const options = {
      runId: task.runId, memory: { thread:task.runId,resource:task.ownerId },
      maxSteps: 8, toolCallConcurrency: 1, maxRetries: 0,
      stopWhen: async () => (await this.store.get(lease.ownerId,lease.taskId)).view.status === 'completed',
      abortSignal: AbortSignal.timeout(45000), modelSettings:{maxOutputTokens:4096},
    };
    const readyResult=task.commands.find(c=>c.runId===task.runId && c.state==='received');
    const output=suspended && readyResult
      ? await agent.resumeStream({commandId:readyResult.id,receipt:readyResult.receipt},{...options,toolCallId:readyResult.toolCallId})
      : await agent.stream(task.view.prompt + (task.commands.length ? `\nRecover from saved progress. Read live context before proposing edits. Prior actions: ${JSON.stringify(task.view.steps)}` : ''),options);
    let text='';
    for await(const chunk of output.fullStream) {
      if(chunk.type==='text-delta') { const delta=chunk.payload.text; text+=delta;onText(delta); }
    }
    const end=await output.getFullOutput();
    if(end.error) throw end.error;
    if(end.finishReason==='suspended') {
      const saved=await agent.listSuspendedRuns({threadId:task.runId,resourceId:task.ownerId});
      const run=saved.runs.find(r=>r.runId===task.runId);
      if(!run) throw new Error('The agent pause was not saved; browser command withheld');
      const ids=run.toolCalls.map(c=>(c.suspendPayload as {commandId?:string})?.commandId).filter((id):id is string=>typeof id==='string');
      await this.store.publish(lease,ids);
      await this.store.release(lease,text);
    } else {
      const latest=await this.store.get(lease.ownerId,lease.taskId);
      await this.store.release(lease,text,latest.view.status==='completed' ? undefined : 'Agent stopped before verifying completion. Resume to continue.');
    }
  }
}
