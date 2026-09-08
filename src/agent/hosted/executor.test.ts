import {beforeAll,expect,test} from 'bun:test';
import {GlobalRegistrator} from '@happy-dom/global-registrator';
import 'fake-indexeddb/auto';
import {Controller} from '../../app/controller.ts';
import {openDb,read} from '../../storage/projects.ts';
import {executeHosted,type Outbox,outboxId} from './executor.ts';
import type {HostedTask} from './protocol.ts';
import type {Mutation} from '../../song/commands.ts';
beforeAll(()=>{if(!GlobalRegistrator.isRegistered)GlobalRegistrator.register();});
function task(songId:string,revision:number):HostedTask {
  const id=crypto.randomUUID(),commandId=crypto.randomUUID();
  return {id,protocol:1,workspaceId:'workspace',songId,prompt:'Rename',status:'running',summary:'',model:'test',createdAt:0,version:1,
    snapshot:{songId,revision,instructions:'',preferences:'',toolVersion:'test'},messages:[],question:null,stepCount:0,segment:1,segmentCalls:0,needsContext:false,
    checkpoint:{version:0,summary:'',nextStep:'',at:0,items:[]},steps:[],command:{id:commandId,name:'mutate',songId,generation:1,fingerprint:'test-hash',
      args:{songId,operationId:commandId,expectedRevision:revision,label:'Agent rename',command:{kind:'edit',changes:[{table:'meta',id:'title',value:'Agent title'}]}}}};
}
test('saved browser effect and result survive reload, redelivery and later undo',async()=>{
  const dbName=crypto.randomUUID();let c=new Controller(await openDb(dbName));
  await c.create('Original');const t=task(c.current!.id,c.current!.revision);
  const first=await executeHosted(c,'owner',t,()=>true);
  expect(first.receipt.ok).toBe(true);expect(c.song!.title).toBe('Agent title');
  const revision=c.current!.revision;c.dispose();
  c=new Controller(await openDb(dbName));await c.init();
  const duplicate=await executeHosted(c,'owner',t,()=>true);
  expect(duplicate).toEqual(first);expect(c.current!.revision).toBe(revision);
  await c.historyAction('undo');expect(c.song!.title).toBe('Original');
  await executeHosted(c,'owner',t,()=>true);expect(c.song!.title).toBe('Original');
  const receipt=await read<Outbox>(c.db,'sessions',outboxId('owner',t.workspaceId,t.command!.id));
  expect(receipt!.receipt.revision).toBe(revision);c.dispose();
});
test('manual edits and Stop prevent stale agent writes',async()=>{
  const c=new Controller(await openDb(crypto.randomUUID()));await c.create('Original');
  const stale=task(c.current!.id,c.current!.revision);await c.patchTitle('Manual');
  const failed=await executeHosted(c,'owner',stale,()=>true);
  expect(failed.receipt.ok).toBe(false);expect(c.song!.title).toBe('Manual');
  const stopped=await executeHosted(c,'owner',task(c.current!.id,c.current!.revision),()=>false);
  expect(stopped.receipt.ok).toBe(false);expect(c.song!.title).toBe('Manual');c.dispose();
});
test('receipt save failure rolls back the musical edit',async()=>{
  const c=new Controller(await openDb(crypto.randomUUID()));await c.create('Original');
  const t=task(c.current!.id,c.current!.revision);
  const r=await c.mutate(t.command!.args as unknown as Mutation,{receipt:()=>{throw new Error('Disk full');}});
  expect(r.ok).toBe(false);await c.refresh();expect(c.song!.title).toBe('Original');c.dispose();
});

test('a post-save UI failure cannot replace the committed success receipt',async()=>{
  const c=new Controller(await openDb(crypto.randomUUID()));await c.create('Original');
  const t=task(c.current!.id,c.current!.revision);
  const unsubscribe=c.subscribe(()=>{
    if(c.song?.title==='Agent title'){unsubscribe();throw new Error('Renderer failed after save');}
  });
  const result=await executeHosted(c,'owner',t,()=>true);
  expect(result.receipt.ok).toBe(true);
  const saved=await read<Outbox>(c.db,'sessions',result.id);
  expect(saved?.receipt.ok).toBe(true);expect(c.song?.title).toBe('Agent title');c.dispose();
});
