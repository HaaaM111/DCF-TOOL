import { reviewAssumptions } from "@/lib/assumption-review";
import { readMetrics } from "@/lib/financial-metrics";
import "server-only";
import { NextRequest } from "next/server";
import { createUIMessageStream,createUIMessageStreamResponse,streamText,stepCountIs } from "ai";
import { randomUUID } from "node:crypto";
import { guardRequest,jsonError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { assumptionsSchema,companySchema } from "@/lib/validation";
import { chatCompletion,createLlmModel,resolveLlmConfig,SERVICE_UNAVAILABLE } from "@/lib/ai-client";
import { readLlmDbSettings } from "@/lib/llm-settings";
import { analystSchema,chatSchema } from "./schemas";
import { createValuationTools } from "./tools";
import { ANALYST_PROMPT,EXECUTOR_PROMPT } from "./roles";
import { groundedText } from "./grounding";
import { calculatePeerValuation } from "@/lib/peer-valuation-service";

export async function handleAgentChat(req:NextRequest){
  const guard=guardRequest(req);if(guard)return guard;
  if(Number(req.headers.get("content-length")||0)>100000)return jsonError("请求过大",413);
  const parsed=chatSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return jsonError("对话参数校验失败",422,"VALIDATION_ERROR");
  const {companyId,messages}=parsed.data;
  const company=await prisma.company.findUnique({where:{id:companyId}});
  const assumption=await prisma.assumption.findUnique({where:{companyId}});
  if(!company||!assumption)return jsonError("标的或已保存假设不存在",404);
  const ca=companySchema.safeParse(company),aa=assumptionsSchema.safeParse(assumption);
  if(!ca.success||!aa.success)return jsonError("已保存模型参数无效，请先校准股本、股价及 Ke/g",422);
  let cfg;try{cfg=resolveLlmConfig(await readLlmDbSettings());}catch{return jsonError("LLM配置地址不受信任",422);}
  if(!cfg)return jsonError(SERVICE_UNAVAILABLE,503,"LLM_UNAVAILABLE");
  const metrics=await readMetrics(companyId);
  const announcements=await prisma.announcement.findMany({where:{companyId},orderBy:{publishAt:"desc"},take:5,select:{title:true,publishAt:true,rawText:true}});
  const signal=AbortSignal.any([req.signal,AbortSignal.timeout(90000)]);
  const configured=Number(process.env.AGENT_MAX_STEPS)||5;
  const maxSteps=Math.min(10,Math.max(1,parsed.data.maxSteps??configured));
  const runId=randomUUID(),evidence:unknown[]=[],trace:{name:string;result:unknown}[]=[];
  const stream=createUIMessageStream({onError:()=>SERVICE_UNAVAILABLE,execute:async({writer})=>{
    const status=(label:string)=>writer.write({type:"data-status",data:{label,runId},transient:true});
    const observe=(name:string,result:unknown)=>{evidence.push(result);trace.push({name,result});};
    let reply="",completed=false;
    try{
      let peerRun: ReturnType<typeof calculatePeerValuation> | undefined;
      const tools=createValuationTools({companyId,assumptions:aa.data,company:{...ca.data,ebit:metrics?.ebit??undefined,ebitda:metrics?.ebitda??undefined},
        peerValuation:()=>peerRun??=calculatePeerValuation(company),cfg,signal,announcements},observe,status);
      status("假设分析师：读取与审视增长率、Ke 假设…");
      const context={company:ca.data,assumptions:aa.data,review:reviewAssumptions(aa.data,ca.data),announcements,source:"已保存数据；财报与市场参数仍需人工校准"};
      observe("get_financial_context",context);
      let handoff=analystSchema.parse({role:"assumption_analyst",reviews:[{field:"ke",assessment:"证据不足",reason:"缺少可核验资本市场参数，仅审视现有用户假设"}],limitations:["当前假设尚未独立校准"]});
      try{
        const analysis=await chatCompletion({config:cfg,signal,messages:[{role:"system",content:ANALYST_PROMPT},{role:"user",content:JSON.stringify(context)}],maxTokens:900});
        const raw=analysis?.content||"";const candidate=JSON.parse(raw.slice(raw.indexOf("{"),raw.lastIndexOf("}")+1));
        handoff=analystSchema.parse(candidate);
      }catch{signal.throwIfAborted();status("假设分析暂不可用，保留已保存假设并标注证据不足");}
      trace.push({name:"analyst_handoff",result:handoff});
      status("估值执行者：接收结构化假设审视结果…");
      const result=streamText({model:createLlmModel(cfg),system:EXECUTOR_PROMPT+"\n【结构化交接】"+JSON.stringify(handoff),messages:[{role:"user",content:"【已验证工具观察】"+JSON.stringify(context)},...messages],tools,
        stopWhen:stepCountIs(maxSteps),prepareStep:({stepNumber})=>stepNumber===0?{toolChoice:"required" as const}:{},maxRetries:0,maxOutputTokens:1800,abortSignal:signal});
      const textId=randomUUID();writer.write({type:"text-start",id:textId});
      let pending="";
      const emit=(text:string)=>{const grounded=groundedText(text,evidence);reply+=grounded;writer.write({type:"text-delta",id:textId,delta:grounded});};
      for await(const part of result.fullStream){
        if(part.type==="text-delta"){
          pending+=part.text;let index;
          while((index=pending.search(/[。！？\n]/))>=0){emit(pending.slice(0,index+1));pending=pending.slice(index+1);}
        }else if(part.type==="error")throw Error(SERVICE_UNAVAILABLE);
      }
      if(pending)emit(pending);
      if(!reply)emit("已达到本轮工具调用上限。已完成工具："+trace.filter(x=>x.name!=="analyst_handoff").map(x=>x.name).join("、")+"。请缩小问题范围后继续，未生成最终估值判断。");
      writer.write({type:"text-end",id:textId});completed=true;status("完成；请复核假设与证据后使用估值");
    }catch{writer.write({type:"error",errorText:SERVICE_UNAVAILABLE});}
    finally{
      // Persist only server-produced messages and evidence, never credentials or internal reasoning.
      try{
        await prisma.appSetting.upsert({where:{key:`agent_run:${runId}`},create:{key:`agent_run:${runId}`,value:JSON.stringify({runId,companyId,completed,maxSteps,trace,createdAt:new Date().toISOString()})},update:{}});
        const last=messages.filter(m=>m.role==="user").at(-1);
        if(last)await prisma.agentConversation.createMany({data:[{companyId,role:"user",content:last.content},...(reply?[{companyId,role:"assistant",content:reply}]:[])]});
      }catch{ /* Do not fail a completed stream because history storage is unavailable. */ }
    }
  }});
  return createUIMessageStreamResponse({stream,headers:{"Cache-Control":"no-store","X-Accel-Buffering":"no"}});
}
