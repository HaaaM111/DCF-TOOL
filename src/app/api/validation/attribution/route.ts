import { NextRequest } from "next/server";
import { z } from "zod";
import { guardRequest,jsonError,jsonOk } from "@/lib/api";
import { idSchema } from "@/lib/agent/schemas";
import { prisma } from "@/lib/prisma";
import { chatCompletion,SERVICE_UNAVAILABLE } from "@/lib/ai-client";
import { readLlmDbSettings } from "@/lib/llm-settings";
import { groundedText } from "@/lib/agent/grounding";
export async function POST(req:NextRequest){
  const guard=guardRequest(req);if(guard)return guard;
  const parsed=z.object({companyId:idSchema}).strict().safeParse(await req.json().catch(()=>null));if(!parsed.success)return jsonError("参数无效",422);
  const report=await prisma.valuationReport.findFirst({where:{companyId:parsed.data.companyId},orderBy:{createdAt:"desc"}});
  const row=report?await prisma.appSetting.findUnique({where:{key:`validation_details:${report.id}`}}):null;
  if(!row)return jsonOk({aiAttribution:"请先完成确定性估值交叉验证"});
  const evidence=JSON.parse(row.value);if(evidence.diffRate===null||evidence.diffRate<20)return jsonOk({aiAttribution:null});
  try{const result=await chatCompletion({config:await readLlmDbSettings(),signal:req.signal,messages:[{role:"system",content:"你是估值归因分析师。所有数值必须来自工具调用结果，不得自行编造；以下JSON为服务器确定性工具观察。仅解释倍数法与DCF的口径差异和证据缺口，不得引入未核实的商业模式、宏观、行业周期、ROE等信息，不得强制二选一断言哪种估值正确。简短中文，不使用数字编号。"},{role:"user",content:JSON.stringify(evidence)}]});return jsonOk({aiAttribution:result?.content?groundedText(result.content,[evidence]):SERVICE_UNAVAILABLE});}catch{return jsonOk({aiAttribution:SERVICE_UNAVAILABLE});}
}
