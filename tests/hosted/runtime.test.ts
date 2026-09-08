import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import type { StreamingModel } from '../../server/agent/meter.ts';
import { database, migrate } from '../../server/agent/database.ts';
import { TaskStore } from '../../server/agent/task-store.ts';
import { AgentRuntime } from '../../server/agent/runtime.ts';
import { agentHandler } from '../../server/agent/http.ts';
import { hostedTaskSchema, type TaskRequest, type ToolReceipt } from '../../src/agent/hosted/protocol.ts';

const url = process.env.AGENT_TEST_DATABASE_URL;
if (!url) throw new Error('AGENT_TEST_DATABASE_URL must point to a disposable Postgres database.');
const connection = database(url);
const store = new TaskStore(connection.pool, 'scripted-test');
const owner = `test-${crypto.randomUUID()}`;
const input = (): TaskRequest => ({
  protocol: 1, requestId: crypto.randomUUID(), workspaceId: crypto.randomUUID(),
  songId: 'song', prompt: 'Change the title and verify it.',
  snapshot: { songId: 'song', revision: 0, instructions: '', preferences: '', toolVersion: 'proof-v1' },
});
beforeAll(async () => { await migrate(url); }, 60000);
afterAll(async () => {
  await connection.pool.query('DELETE FROM songwriting_agent.charges WHERE owner_id=$1', [owner]);
  await connection.pool.query('DELETE FROM songwriting_agent.tasks WHERE owner_id=$1', [owner]);
  await connection.pool.query('DELETE FROM songwriting_agent.usage WHERE owner_id=$1', [owner]);
  await connection.pool.end();
});

// No provider calls: this tests the real Mastra/Postgres handoff, not musical judgment.
function scriptedModel(actions: Array<{ name: string; args: Record<string, unknown> }>): StreamingModel {
  let index = 0;
  return {
    specificationVersion: 'v2', provider: 'test', modelId: 'scripted-test', supportedUrls: {},
    doGenerate: async () => { throw new Error('Streaming required'); },
    doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      const action = actions[index++];
      controller.enqueue({ type: 'stream-start', warnings: [] });
      if (action) controller.enqueue({ type: 'tool-call', toolCallId: `call-${index}`,
        toolName: action.name, input: JSON.stringify(action.args) });
      controller.enqueue({ type: 'finish', finishReason: action ? 'tool-calls' : 'stop',
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } });
      controller.close();
    } }) }),
  };
}

test('request retries are idempotent and tasks are private to their owner', async () => {
  const request = input();
  const created = await store.create(owner, request);
  expect((await store.create(owner, request)).id).toBe(created.id);
  await expect(store.create(owner, { ...request, prompt: 'Different' })).rejects.toThrow('identity');
  await expect(store.get('different-owner', created.id)).rejects.toThrow('not found');
  expect(await store.list('different-owner', request.workspaceId)).toEqual([]);
  await expect(store.create(owner, { ...request, requestId: crypto.randomUUID() })).rejects.toThrow('current task');
});

test('fresh runtime resumes stored suspensions and duplicate receipts do not repeat steps', async () => {
  const task = await store.create(owner, input());
  const model = scriptedModel([
    { name: 'context', args: {} },
    { name: 'mutate', args: { expectedRevision: 0, label: 'Rename', command: {
      kind: 'edit', changes: [{ table: 'meta', id: 'title', value: 'New title' }],
    } } },
    { name: 'read', args: {} },
    { name: 'complete_task', args: { summary: 'Renamed and verified.' } },
  ]);
  // Each advance constructs another pool, storage adapter, runtime and agent.
  async function advance() {
    const fresh = database(url!);
    try { return await new AgentRuntime(new TaskStore(fresh.pool, 'scripted-test'), fresh.storage, model, undefined,
      {input:0.000001,output:0.000002}).advance(owner, task.id); }
    finally { await fresh.pool.end(); }
  }
  for (const [index, name] of ['context', 'mutate', 'read'].entries()) {
    const view = hostedTaskSchema.parse(await advance());
    expect(view.status).toBe('running');
    expect(view.command?.name).toBe(name);
    expect((await store.get(owner,task.id)).reservedUsd).toBeLessThan(0.001);
    const command = view.command!;
    const receipt: ToolReceipt = { ok: true, songId: 'song', revision: index === 0 ? 0 : 1,
      value: { title: index === 0 ? 'Old title' : 'New title' } };
    const deliver = () => store.receive(owner, task.id, task.workspaceId, 'song', command.id, command.fingerprint, receipt);
    await deliver();
    await deliver();
    expect((await store.get(owner, task.id)).view.steps.length).toBe(index + 1);
    await expect(store.receive(owner, task.id, task.workspaceId, 'song', command.id, command.fingerprint,
      { ...receipt, value: 'conflicting' })).rejects.toThrow('Conflicting duplicate');
  }
  const done = await advance();
  expect(done.status).toBe('completed');
  expect(done.summary).toBe('Renamed and verified.');
  expect(done.command).toBeNull();
}, 60000);

test('expired worker cannot publish a command and cancellation fences subsequent work', async () => {
  let clock = 100000;
  const timed = new TaskStore(connection.pool, 'scripted-test', () => clock);
  const task = await timed.create(owner, input());
  const lease = await timed.acquire(owner, task.id);
  const command = await timed.stage(lease, 'context', 'context', {});
  clock += 56000;
  await expect(timed.publish(lease, [command.id])).rejects.toThrow('lease expired');
  const fresh = await timed.acquire(owner, task.id);
  await timed.control(owner, task.id, task.workspaceId, 'cancel');
  await expect(timed.stage(fresh, 'another', 'context', {})).rejects.toThrow('lease expired');
  expect((await timed.get(owner, task.id)).view.command).toBeNull();
});

test('completion needs a verified result and quota failure preserves task state', async () => {
  const task = await store.create(owner, input());
  const lease = await store.acquire(owner, task.id);
  await expect(store.finish(lease, 'Done')).rejects.toThrow('verify');
  await expect(store.stage(lease, 'write', 'mutate', {})).rejects.toThrow('fresh context');
  await expect(store.reserve(lease, 2, 1, 5)).rejects.toThrow('budget');
  expect((await store.get(owner, task.id)).calls).toBe(0);
  await expect(store.control('different-owner', task.id, task.workspaceId, 'cancel')).rejects.toThrow('not found');
});

test('authenticated API binds every action to the verified session owner',async()=>{
  // Mock only Neon's upstream session response; use the real proxy, HTTP handler,
  // request validation and Postgres owner predicates. No production auth bypass.
  const upstream=spyOn(globalThis,'fetch').mockImplementation(Object.assign(async(...[_url,options]:Parameters<typeof fetch>)=>{
    const cookie=new Headers(options?.headers).get('cookie')??'';
    const id=cookie.includes('account-a')?owner:'different-owner';
    const dates={createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    return Response.json({user:{id,email:'writer@example.invalid',emailVerified:!cookie.includes('unverified'),...dates},
      session:{userId:id,expiresAt:new Date(Date.now()+60000).toISOString(),...dates}});
  },{preconnect:fetch.preconnect}));
  const handler=agentHandler({store,runtime:new AgentRuntime(store,connection.storage,scriptedModel([])),enabled:true,
    auth:{baseUrl:'https://auth.example.invalid',cookieSecret:'test-cookie-secret-with-at-least-32-characters',
      allowedEmails:['writer@example.invalid'],allowedIds:[]}});
  const post=(account:string,body:unknown)=>handler(new Request('https://app.example/api/agent',{method:'POST',
    headers:{origin:'https://app.example','content-type':'application/json',cookie:`__Secure-neon-auth.session_token=${account}`},body:JSON.stringify(body)}));
  try {
    const request=input();
    const created=await post('account-a',{action:'create',...request});expect(created.status).toBe(200);
    const task=hostedTaskSchema.parse(await created.json());
    expect((await (await post('account-b',{action:'list',workspaceId:request.workspaceId})).json()).tasks).toEqual([]);
    for(const action of ['advance','control','result']) {
      const response=await post('account-b',{action,id:task.id,workspaceId:request.workspaceId,control:'cancel',
        protocol:1,songId:task.songId,commandId:'unknown',generation:1,fingerprint:'unknown',receipt:{ok:true,songId:task.songId,revision:1}});
      expect(response.ok).toBe(false);
    }
    expect((await post('unverified',{action:'create',...input()})).status).toBe(403);
    const dates={createdAt:'1999-01-01T00:00:00Z',updatedAt:'1999-01-01T00:00:00Z'};
    const expired=upstream.mockImplementation(Object.assign(async()=>Response.json({user:{id:owner,email:'writer@example.invalid',emailVerified:true,...dates},
      session:{userId:owner,expiresAt:'2000-01-01T00:00:00Z',...dates}}),{preconnect:fetch.preconnect}));
    expect((await post('account-a',{action:'list',workspaceId:request.workspaceId})).status).toBe(401);
    expect(expired).toHaveBeenCalled();
  } finally {upstream.mockRestore();}
});

test('usage settlement is idempotent and cannot be charged to another owner',async()=>{
  const task=await store.create(owner,input()), lease=await store.acquire(owner,task.id);
  const charge=await store.reserve(lease,0.2,1,5);
  await expect(store.settle('different-owner',charge,0)).rejects.toThrow('Unknown');
  await store.settle(owner,charge,0.001);await store.settle(owner,charge,0.002);
  expect((await store.get(owner,task.id)).reservedUsd).toBeCloseTo(0.001);
});

test('provider rate limits wait without extra calls and stop after bounded retries',async()=>{
  const task=await store.create(owner,input());
  const model=scriptedModel([]);
  model.doStream=async()=>{throw new Error('Free tier requests are rate-limited');};
  const runtime=new AgentRuntime(store,connection.storage,model);
  const waiting=await runtime.advance(owner,task.id);
  expect(waiting.status).toBe('running');expect(waiting.nextAttemptAt).toBeGreaterThan(Date.now());
  await runtime.advance(owner,task.id);expect((await store.get(owner,task.id)).calls).toBe(1);
  for(let retry=0;retry<2;retry++){
    await store.update(owner,task.id,t=>{t.view.nextAttemptAt=0;});
    await runtime.advance(owner,task.id);
  }
  expect((await store.get(owner,task.id)).view.status).toBe('partial');
  expect((await store.get(owner,task.id)).calls).toBe(3);
});

test('resuming an older task cannot compete with another active request',async()=>{
  const request=input();const old=await store.create(owner,request);
  await store.control(owner,old.id,old.workspaceId,'cancel');
  await store.create(owner,{...request,requestId:crypto.randomUUID()});
  await expect(store.control(owner,old.id,old.workspaceId,'resume')).rejects.toThrow('current task');
});

test('late committed receipt survives cancellation and forces fresh context after resume',async()=>{
  const task=await store.create(owner,input()), lease=await store.acquire(owner,task.id);
  const context=await store.stage(lease,'context','context',{});await store.publish(lease,[context.id]);
  await store.receive(owner,task.id,task.workspaceId,task.songId,context.id,context.fingerprint,{ok:true,songId:task.songId,revision:0});
  const mutation=await store.stage(lease,'mutation','mutate',{expectedRevision:0,command:{kind:'edit',changes:[]}});
  await store.publish(lease,[mutation.id]);
  await store.control(owner,task.id,task.workspaceId,'cancel');
  await store.control(owner,task.id,task.workspaceId,'resume');
  const receipt={ok:true,songId:task.songId,revision:1,operationId:mutation.id};
  await store.receive(owner,task.id,task.workspaceId,task.songId,mutation.id,mutation.fingerprint,receipt);
  await store.receive(owner,task.id,task.workspaceId,task.songId,mutation.id,mutation.fingerprint,receipt);
  const saved=await store.get(owner,task.id);
  expect(saved.view.needsContext).toBe(true);expect(saved.lastMutationRevision).toBe(1);
  expect(saved.view.steps.filter(s=>s.id===mutation.id)).toHaveLength(1);
});
