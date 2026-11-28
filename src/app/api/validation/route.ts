import { NextRequest } from "next/server";
import { guardRequest,jsonOk,jsonError } from "@/lib/api";
import { idSchema } from "@/lib/agent/schemas";
import { z } from "zod";
import { validateCompany } from "@/lib/valuation-service";
import { prisma } from "@/lib/prisma";
import { companyAccessWhere } from "@/lib/auth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){const guard=await guardRequest(req);if(guard)return guard;const parsed=z.object({companyId:idSchema}).strict().safeParse(await req.json().catch(()=>null));if(!parsed.success)return jsonError("companyId无效",422);if(!await prisma.company.findFirst({where:companyAccessWhere(req,parsed.data.companyId),select:{id:true}}))return jsonError("标的不存在",404,"NOT_FOUND");try{return jsonOk(await validateCompany(parsed.data.companyId));}catch{return jsonError("估值数据不足或参数无效，请校准模型",422);}}
