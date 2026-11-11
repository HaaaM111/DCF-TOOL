import { NextRequest } from "next/server";
import { z } from "zod";
import { guardRequest,jsonOk,jsonError } from "@/lib/api";
import { assumptionsSchema } from "@/lib/validation";
import { simulationConfigSchema,simulateWithJumps } from "@/lib/jump-simulation";
export const runtime="nodejs";
const schema=simulationConfigSchema.extend({assumptions:assumptionsSchema,company:z.object({currentPrice:z.number().positive(),shares:z.number().positive(),netCash:z.number().finite(),e0:z.number().finite()})});
export async function POST(req:NextRequest){const guard=guardRequest(req);if(guard)return guard;const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return jsonError("模拟参数无效",422);try{return jsonOk({result:simulateWithJumps(parsed.data.assumptions,parsed.data.company,parsed.data)});}catch{return jsonError("有效样本不足，请校准参数",422);}}
