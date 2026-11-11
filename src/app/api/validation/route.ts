import { NextRequest } from "next/server";
import { guardRequest,jsonOk,jsonError } from "@/lib/api";
import { idSchema } from "@/lib/agent/schemas";
import { z } from "zod";
import { validateCompany } from "@/lib/valuation-service";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){const guard=guardRequest(req);if(guard)return guard;const parsed=z.object({companyId:idSchema}).strict().safeParse(await req.json().catch(()=>null));if(!parsed.success)return jsonError("companyId无效",422);try{return jsonOk(await validateCompany(parsed.data.companyId));}catch{return jsonError("估值数据不足或参数无效，请校准模型",422);}}
