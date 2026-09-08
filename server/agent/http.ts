import { z } from 'zod';
import { session, sameOrigin, HttpError, type AuthConfig } from './auth.ts';
import { hostedTaskSchema, taskRequestSchema, resultRequestSchema, identity } from '../../src/agent/hosted/protocol.ts';
import type { TaskStore } from './task-store.ts';
import type { AgentRuntime } from './runtime.ts';
const idSchema = z.object({ id: z.uuid(), workspaceId: identity });
const requestSchema = z.discriminatedUnion('action', [
  taskRequestSchema.extend({ action: z.literal('create') }),
  z.object({action:z.literal('list'),workspaceId:identity}),
  idSchema.extend({action:z.literal('advance')}),
  idSchema.extend({action:z.literal('control'),control:z.enum(['cancel','resume'])}),
  resultRequestSchema.extend({action:z.literal('result'),id:z.uuid()}),
]);
export function agentHandler(deps: { auth: AuthConfig; store: TaskStore; runtime: AgentRuntime; enabled: boolean }) {
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({'cache-control':'no-store'});
    try {
      sameOrigin(request);
      const auth = await session(request,deps.auth);
      for(const cookie of auth.cookies) headers.append('set-cookie',cookie);
      if(request.method === 'GET') return Response.json({user:auth.user,allowed:auth.allowed,enabled:deps.enabled}, {headers});
      if(!auth.user) throw new HttpError(401,'Sign in to use the songwriting agent.');
      if(!auth.allowed) throw new HttpError(403,'Agent access is invite-only. Verify your email and use your invited account.');
      if(!deps.enabled) throw new HttpError(503,'The hosted agent is temporarily paused. Your songs remain available.');
      const text=await request.text();
      if(text.length>256000) throw new HttpError(413,'Agent request is too large.');
      const data=requestSchema.parse(JSON.parse(text));
      const owner=auth.user.id;
      if(data.action==='create') return Response.json(hostedTaskSchema.parse(await deps.store.create(owner,data)),{headers});
      if(data.action==='list') return Response.json({protocol:1,tasks:(await deps.store.list(owner,data.workspaceId)).map(t=>hostedTaskSchema.parse(t))},{headers});
      const task=await deps.store.get(owner,data.id);
      if(task.view.workspaceId!==data.workspaceId) throw new HttpError(404,'Task not found.');
      if(data.action==='control') await deps.store.control(owner,data.id,data.workspaceId,data.control);
      if(data.action==='result') {
        const command=task.commands.find(c=>c.id===data.commandId);
        if(command?.generation!==data.generation) throw new HttpError(409,'Command generation changed.');
        await deps.store.receive(owner,data.id,data.workspaceId,data.songId,data.commandId,data.fingerprint,data.receipt);
      }
      if(data.action==='advance') {
        headers.set('content-type','application/x-ndjson');
        const encoder=new TextEncoder();
        const body=new ReadableStream<Uint8Array>({ async start(controller) {
          const send=(value:unknown)=>controller.enqueue(encoder.encode(JSON.stringify(value)+'\n'));
          try {
            const result=await deps.runtime.advance(owner,data.id,text=>send({type:'text',text}));
            send({type:'task',task:hostedTaskSchema.parse(result)});
          } catch { send({type:'error',error:'Agent work was interrupted. Reconnect to recover saved progress.'}); }
          finally {controller.close();}
        } });
        return new Response(body,{headers});
      }
      return Response.json(hostedTaskSchema.parse((await deps.store.get(owner,data.id)).view),{headers});
    } catch(error) {
      const status=error instanceof HttpError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 409;
      const message=error instanceof HttpError ? error.message : status===400 ? 'Invalid agent request.' :
        error instanceof Error && ['Task not found','Stop or finish the current task before sending another request','Request identity reused with different content'].includes(error.message)
          ? error.message : 'The request conflicted with saved task state. Refresh and try again.';
      return Response.json({error:message},{status,headers});
    }
  };
}
