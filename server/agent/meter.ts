import type { MastraModelConfig } from '@mastra/core/llm';
import { z } from 'zod';

export type StreamingModel = Extract<MastraModelConfig, { doStream: unknown }>;
const count = z.union([z.number().nonnegative(), z.object({total:z.number().nonnegative()}).transform(v=>v.total)]);
const usageSchema = z.object({inputTokens:count,outputTokens:count});

// Observe the provider stream separately: Mastra may suspend a browser tool
// before forwarding the provider's final usage event to its step callbacks.
export function meterModel<T extends StreamingModel>(model:T,
  reserve:()=>Promise<(usage:{inputTokens:number;outputTokens:number})=>Promise<void>>) {
  const pending:Promise<void>[]=[];
  const wrapped = new Proxy(model, {get(target,key,receiver) {
    if(key!=='doStream') return Reflect.get(target,key,receiver);
    return async (...args:unknown[])=>{
      const settle=await reserve();
      const result=await Reflect.apply(target.doStream,target,args);
      const [stream,accounting]=result.stream.tee();
      pending.push((async()=>{
        const reader=accounting.getReader();
        try {
          while(true) {
            const {done,value}=await reader.read();if(done)break;
            if(value.type==='finish') {
              const parsed=usageSchema.safeParse(value.usage);
              if(parsed.success) await settle(parsed.data);
            }
          }
        } catch { /* Retain the reservation when final usage cannot be recovered. */ }
        finally {reader.releaseLock();}
      })());
      return {...result,stream};
    };
  } });
  return {model:wrapped,finished:()=>Promise.all(pending)};
}
