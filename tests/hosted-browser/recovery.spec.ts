import {createHash,randomUUID} from 'node:crypto';
import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import type {HostedTask,TaskRequest,ToolReceipt} from '../../src/agent/hosted/protocol.ts';
import {canonicalJson} from '../../src/agent/hosted/canonical.ts';

// Deterministic HTTP peer, not an authentication or musical-judgment evaluation.
// The actual browser UI, IndexedDB transactions, Web Locks and outbox run here.
async function peer(context:BrowserContext) {
  let signedIn=false, task:HostedTask|undefined, stage=0, revision=0;
  let dropResult=false, dropAfterSave=false, holdMutation=false;
  let releaseMutation:(()=>void)|undefined;
  let mutationsOffered=0, resultDeliveries=0;
  const receipts=new Map<string,ToolReceipt>();
  const json=(body:unknown)=>({status:200,contentType:'application/json',body:JSON.stringify(body)});
  await context.route('**/api/auth/**',async route=>{
    signedIn=!route.request().url().endsWith('sign-out');
    await route.fulfill(json({}));
  });
  await context.route('**/api/agent',async route=>{
    if(route.request().method()==='GET')return route.fulfill(json({
      user:signedIn?{id:'test-owner',email:'writer@example.invalid'}:null,allowed:signedIn,enabled:true}));
    if(!signedIn)return route.fulfill({status:401,json:{error:'Sign in'}});
    const body=route.request().postDataJSON();
    if(body.action==='list')return route.fulfill(json({protocol:1,tasks:task?[task]:[]}));
    if(body.action==='create') {
      const request=body as TaskRequest;
      task ??= {...request,id:randomUUID(),status:'pending',summary:'',model:'scripted-test',createdAt:Date.now(),version:1,
        messages:[],command:null,question:null,stepCount:0,segment:1,segmentCalls:0,needsContext:true,
        checkpoint:{version:0,summary:'',nextStep:'',at:0,items:[]},steps:[]};
      return route.fulfill(json(task));
    }
    if(!task)throw new Error('No test task');
    if(body.action==='control') {
      task.status=body.control==='cancel'?'cancelled':'pending';task.command=null;task.version++;
      return route.fulfill(json(task));
    }
    if(body.action==='result') {
      resultDeliveries++;
      const receipt=body.receipt as ToolReceipt;
      if(dropResult && !dropAfterSave){dropResult=false;return route.abort('failed');}
      if(!receipts.has(body.commandId)){
        receipts.set(body.commandId,receipt);revision=receipt.revision!;stage++;
        task.steps.push({id:body.commandId,name:task.command!.name,status:'done',error:receipt.error??'',effect:receipt.effect??null});
        task.command=null;task.version++;
        if(!receipt.ok){task.status='partial';task.summary=receipt.error??'Failed';}
      }
      if(dropResult){dropResult=false;return route.abort('failed');}
      return route.fulfill(json(task));
    }
    if(body.action==='advance') {
      task.status='running';task.version++;
      const name=['context','mutate','read'][stage];
      if(name) {
        const id=randomUUID();
        const args=name==='mutate'?{songId:task.songId,operationId:id,expectedRevision:revision,label:'Agent rename',
          command:{kind:'edit',changes:[{table:'meta',id:'title',value:'Agent title'}]}}:{};
        task.command={id,name,args,songId:task.songId,generation:1,
          fingerprint:createHash('sha256').update(canonicalJson({name,args,songId:task.songId})).digest('hex')};
      } else {task.status='completed';task.summary='Renamed and verified.';task.command=null;}
      const responseTask=structuredClone(task);
      if(name==='mutate'){
        mutationsOffered++;
        if(holdMutation)await new Promise<void>(resolve=>{releaseMutation=resolve;});
      }
      return route.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({type:'task',task:responseTask})+'\n'});
    }
    throw new Error('Unknown test action');
  });
  return {
    drop(afterSave:boolean){dropResult=true;dropAfterSave=afterSave;},
    hold(){holdMutation=true;},release(){releaseMutation?.();},
    get task(){return task;},get mutations(){return mutationsOffered;},get deliveries(){return resultDeliveries;},get receipts(){return receipts;},
  };
}
async function boot(page:Page) {
  await page.goto('/');
  await page.getByRole('button',{name:'Start a song'}).click();
  await page.getByRole('button',{name:'Toggle agent panel',exact:true}).click();
  await page.getByLabel('Agent sign-in email').fill('writer@example.invalid');
  await page.getByLabel('Agent sign-in password').fill('test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Send to agent ↗'})).toBeEnabled();
}
async function submit(page:Page) {
  await page.getByLabel('Agent request').fill('Rename the song to Agent title.');
  await page.getByRole('button',{name:'Send to agent ↗'}).click();
}
for(const afterSave of [false,true])test(`reload reconciles ${afterSave?'lost acknowledgement':'lost request'} without repeating an edit`,async({page,context})=>{
  const server=await peer(context);await boot(page);server.hold();await submit(page);
  await expect.poll(()=>server.mutations).toBe(1);
  server.drop(afterSave);server.release();
  await expect(page.getByLabel('Song title')).toHaveValue('Agent title');
  await expect.poll(()=>server.deliveries).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(page.getByLabel('Song title')).toHaveValue('Agent title');
  await expect.poll(()=>server.task?.status).toBe('completed');
  const history=await page.evaluate(()=> (window as any).songwriting.controller.current.history);
  expect(history.filter((h:any)=>h.label==='Agent rename')).toHaveLength(1);
  expect(server.mutations).toBe(1);
  await page.evaluate(()=> (window as any).songwriting.controller.historyAction('undo'));
  await expect(page.getByLabel('Song title')).toHaveValue('First sketch');
  await page.reload();await expect(page.getByLabel('Song title')).toHaveValue('First sketch');
});
test('a manual edit wins against a stale queued mutation',async({page,context})=>{
  const server=await peer(context);await boot(page);server.hold();await submit(page);
  await expect.poll(()=>server.mutations).toBe(1);
  await page.getByLabel('Song title').fill('Writer title');await page.getByLabel('Song title').press('Tab');
  await expect(page.getByText('All changes saved')).toBeVisible();server.release();
  await expect.poll(()=>server.task?.status).toBe('partial');
  await expect(page.getByLabel('Song title')).toHaveValue('Writer title');
  expect([...server.receipts.values()].some(r=>!r.ok)).toBe(true);
});
test('Stop rejects an in-flight command and another tab does not duplicate work',async({page,context})=>{
  const server=await peer(context);await boot(page);server.hold();await submit(page);
  await expect.poll(()=>server.mutations).toBe(1);
  const other=await context.newPage();await other.goto('/');
  await expect(other.getByLabel('Song title')).toHaveValue('First sketch');
  await page.locator('.task').getByRole('button',{name:'Cancel',exact:true}).click();
  await expect.poll(()=>server.task?.status).toBe('cancelled');server.release();
  await expect(page.locator('.task')).toContainText('CANCELLED');
  await expect(page.getByLabel('Song title')).toHaveValue('First sketch');
  expect(server.mutations).toBe(1);
  expect([...server.receipts.values()].some(r=>r.operationId)).toBe(false);
});

test('sign-out fences an in-flight browser edit and clears task visibility',async({page,context})=>{
  const server=await peer(context);await boot(page);server.hold();await submit(page);
  await expect.poll(()=>server.mutations).toBe(1);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();server.release();
  await expect(page.getByLabel('Agent sign-in email')).toBeVisible();
  await expect(page.locator('.task')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Send to agent ↗'})).toBeDisabled();
  await expect(page.getByLabel('Song title')).toHaveValue('First sketch');
  expect([...server.receipts.values()].some(r=>r.operationId)).toBe(false);
});
