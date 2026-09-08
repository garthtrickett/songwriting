import { createGateway } from '@ai-sdk/gateway';
import { database } from '../server/agent/database.ts';
import { settings } from '../server/agent/config.ts';
import { TaskStore } from '../server/agent/task-store.ts';
import { AgentRuntime } from '../server/agent/runtime.ts';
import { agentHandler } from '../server/agent/http.ts';
let handler: ReturnType<typeof agentHandler> | undefined;
async function route(request: Request) {
  try {
    if(!handler) {
      const config=settings();
      const {pool,storage}=database(config.databaseUrl);
      const store=new TaskStore(pool,config.model);
      const gateway=createGateway();
      const model=(await gateway.getAvailableModels()).models.find(m=>m.id===config.model);
      const prices=model?.pricing ? {input:Number(model.pricing.input),output:Number(model.pricing.output)} : undefined;
      handler=agentHandler({auth:config.auth,store,enabled:config.enabled,
        runtime:new AgentRuntime(store,storage,gateway(config.model),undefined,prices)});
    }
    return await handler(request);
  } catch { return Response.json({error:'Hosted agent configuration is unavailable.'},{status:503,headers:{'cache-control':'no-store'}}); }
}
export {route as GET,route as POST};
