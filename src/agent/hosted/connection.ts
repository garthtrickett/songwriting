import type { Controller } from '../../app/controller.ts';
import type { AgentView } from '../../app/view.ts';
import { read, save, list } from '../../storage/projects.ts';
import { hostedTaskSchema, taskListSchema, type HostedTask, type TaskRequest } from './protocol.ts';
import { executeHosted, verifyCommand, type Outbox } from './executor.ts';

export function hostedConnection(c: Controller): AgentView & {start():void;stop():void} {
  let stopped=false, running=false, owner='', workspace='', timer:ReturnType<typeof setTimeout>|undefined;
  let tasks:HostedTask[]=[];
  let authEpoch=0;
  const cancelled=new Set<string>();
  const authChannel = new BroadcastChannel('songwriting-agent-auth');
  authChannel.onmessage=()=>{authEpoch++;owner='';tasks=[];view.connected=false;view.tasks=[];void start();};
  const view: AgentView & {start():void;stop():void} = {
    connected:false,tasks:[],hosted:true,status:'Checking sign-in…',streaming:'',
    auth:{email:'',signedIn:false,allowed:false},
    async signIn(email,password,register) {
      const response=await fetch(`/api/auth/${register?'sign-up/email':'sign-in/email'}`,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({email,password,...(register?{name:email.split('@')[0],callbackURL:location.origin}:{} )})});
      const data=await response.json();
      if(!response.ok) throw new Error(data.message ?? data.error ?? 'Sign-in failed.');
      view.status=register?'Check your email to verify your account, then sign in.':'Signed in.';
      authChannel.postMessage('changed');await start();
      if(register && !view.connected) {view.status='Check your email to verify your account, then sign in.';c.notify();}
    },
    async signOut() {
      authEpoch++;owner='';tasks=[];view.connected=false;view.tasks=[];view.auth={email:'',signedIn:false,allowed:false};
      if(timer) clearTimeout(timer);c.notify();
      const response=await fetch('/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      if(!response.ok) throw new Error('Sign-out failed. Reconnect and try again.');
      authChannel.postMessage('changed');
      await start();
    },
    async submit(prompt) {
      if(!owner || !view.connected) throw new Error('Sign in before sending a request.');
      if(!c.song) throw new Error('Open or create a song first.');
      const key=`hosted-submit:${owner}:${workspace}`;
      const previous=await read<{id:string;request:TaskRequest}>(c.db,'sessions',key);
      if(previous && previous.request.prompt!==prompt) throw new Error('A previous request needs recovery. Reconnect before sending another.');
      const request:TaskRequest=previous?.request ?? {protocol:1,requestId:crypto.randomUUID(),workspaceId:workspace,songId:c.song.id,prompt,
        snapshot:{songId:c.song.id,revision:c.current!.revision,instructions:c.song.writing.instructions.slice(0,8000),
          preferences:c.song.writing.preferences.slice(0,4000),toolVersion:'mastra-browser-v1'}};
      await save(c.db,'sessions',{id:key,request});
      await requestApi({action:'create',...request});
      await clearPending(key);await sync();void pump();
    },
    async control(id,action) {
      if(action==='cancel') cancelled.add(id);
      // Reconcile any locally committed result before Resume rotates the run.
      if(action==='resume') await flush();
      await requestApi({action:'control',id,workspaceId:workspace,control:action});
      if(action==='resume') cancelled.delete(id);
      await sync();void pump();
    },
    start(){void start();},
    stop(){stopped=true;authEpoch++;owner='';if(timer) clearTimeout(timer);authChannel.close();},
  };
  async function clearPending(key:string) {
    await new Promise<void>((resolve,reject)=>{const tx=c.db.transaction('sessions','readwrite');tx.objectStore('sessions').delete(key);
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
  }
  async function requestApi(body:unknown) {
    const account=owner;
    const response=await fetch('/api/agent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(account!==owner || stopped) throw new Error('Sign-in changed. Saved edits are retained.');
    if(response.status===401){
      authEpoch++;owner='';tasks=[];view.tasks=[];view.connected=false;
      view.auth={email:'',signedIn:false,allowed:false};c.notify();
    }
    if(!response.ok) throw new Error(data.error ?? 'Agent request failed.');
    return data;
  }
  function paint() {
    view.tasks=tasks.map(t=>({...t,clientId:t.workspaceId,provider:'Mastra',segmentStart:0}));c.notify();
  }
  async function sync() {
    const account=owner;
    const parsed=taskListSchema.parse(await requestApi({action:'list',workspaceId:workspace}));
    if(account!==owner || stopped)return;
    tasks=parsed.tasks;paint();
  }
  async function start() {
    if(stopped)return;
    const epoch=authEpoch;
    try {
      if(!navigator.locks) throw new Error('This browser cannot safely coordinate agent edits across tabs.');
      workspace=await navigator.locks.request('songwriting-workspace',async()=>{
        const existing=await read<{id:string;value:string}>(c.db,'settings','hosted-workspace');
        if(existing)return existing.value;
        const value=crypto.randomUUID();await save(c.db,'settings',{id:'hosted-workspace',value});return value;
      });
      const response=await fetch('/api/agent');const data=await response.json();
      if(stopped || epoch!==authEpoch)return;
      if(!response.ok) throw new Error(data.error ?? 'Hosted agent is unavailable.');
      const nextOwner=typeof data.user?.id==='string'?data.user.id:'';
      if(nextOwner!==owner){tasks=[];view.tasks=[];}
      owner=nextOwner;
      view.auth={email:data.user?.email ?? '',signedIn:!!owner,allowed:data.allowed===true};
      view.connected=!!owner && data.allowed===true && data.enabled===true;
      view.status=!owner ? 'Sign in to compose with your agent.' : !data.allowed ?
        'Verify your email and use your invited account to enable the agent.' : !data.enabled ? 'The hosted agent is paused.' : 'Ready to work with the open song.';
      if(view.connected) {
        const key=`hosted-submit:${owner}:${workspace}`;
        const pending=await read<{id:string;request:TaskRequest}>(c.db,'sessions',key);
        if(pending){await requestApi({action:'create',...pending.request});await clearPending(key);}
        await flush();await sync();void pump();
      }
    } catch(error) {
      if(stopped || epoch!==authEpoch)return;
      view.connected=false;view.status=error instanceof Error?error.message:'Could not connect.';
      if(timer) clearTimeout(timer);
      timer=setTimeout(()=>{void start();},5000);
    }
    c.notify();
  }
  async function flush() {
    const account=owner;
    const prefix=`hosted:${owner}:${workspace}:`;
    for(const record of await list<Outbox>(c.db,'sessions')) {
      if(account!==owner || stopped)return;
      if(record.id.startsWith(prefix) && !record.acknowledged) await deliverRecord(record);
    }
  }
  async function deliverRecord(record:Outbox) {
    if(!record.id.startsWith(`hosted:${owner}:${workspace}:`))throw new Error('Receipt belongs to a different signed-in workspace.');
    await requestApi({action:'result',protocol:1,id:record.taskId,workspaceId:workspace,songId:record.songId,
      commandId:record.commandId,generation:record.generation,fingerprint:record.fingerprint,receipt:record.receipt});
    await save(c.db,'sessions',{...record,acknowledged:true});
  }
  async function deliver(_task:HostedTask,record:Outbox) { await deliverRecord(record); }
  async function advance(task:HostedTask,account:string) {
    const response=await fetch('/api/agent',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({action:'advance',id:task.id,workspaceId:workspace})});
    if(!response.ok) {const data=await response.json();throw new Error(data.error ?? 'Agent request failed.');}
    if(!response.body)throw new Error('Agent stream is missing.');
    const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer='';view.streaming='';
    while(true){const {value,done}=await reader.read();if(done)break;buffer+=value;
      if(buffer.length>256000)throw new Error('Agent response too large.');
      let end:number;
      while((end=buffer.indexOf('\n'))>=0){const event=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
        if(owner!==account || stopped)continue;
        if(event.type==='text'){view.streaming=(view.streaming+String(event.text)).slice(-16000);c.notify();}
        if(event.type==='error')throw new Error(event.error);
        if(event.type==='task'){
          const next=hostedTaskSchema.parse(event.task);
          if(!cancelled.has(next.id) || next.status==='cancelled'){tasks=tasks.map(t=>t.id===next.id?next:t);paint();}
        }
      }
    }
    if(buffer.trim())throw new Error('Agent stream was interrupted.');
  }
  async function pump() {
    if(running || stopped || !view.connected)return;
    running=true;
    let retry=false;
    try {
      await navigator.locks.request(`songwriting-agent:${workspace}`,{ifAvailable:true},async lock=>{
        if(!lock){view.status='Agent editing is active in another tab.';retry=true;return;}
        const account=owner;
        while(!stopped && account===owner && view.connected) {
          const task=tasks.find(t=>['pending','running'].includes(t.status) && !cancelled.has(t.id));
          if(!task)break;
          if((task.nextAttemptAt??0)>Date.now()){view.status=task.summary;retry=true;return;}
          if(task.songId!==c.current?.id){view.status='Reopen the task song to continue. Saved progress is retained.';retry=true;return;}
          if(task.command){
            await verifyCommand(task.command);
            const record=await executeHosted(c,account,task,()=>!stopped && account===owner && !cancelled.has(task.id));
            if(account!==owner)break;
            await deliver(task,record);await sync();
          } else {
            view.status='Working on your request…';c.notify();await advance(task,account);
            if(tasks.find(t=>t.id===task.id)?.version===task.version){retry=true;break;}
          }
        }
        view.streaming='';view.status='Saved progress is up to date.';
      });
    } catch(error) {
      view.status=error instanceof Error?error.message:'Connection interrupted. Saved edits are retained.';
      retry=!!owner;
    } finally {
      running=false;c.notify();
      if(retry && !stopped && owner){
        if(timer)clearTimeout(timer);
        timer=setTimeout(()=>{void sync().then(pump).catch(()=>{void start();});},5000);
      }
    }
  }
  addEventListener('online',()=>{if(!stopped)void start();});
  addEventListener('focus',()=>{if(!stopped)void start();});
  return view;
}
