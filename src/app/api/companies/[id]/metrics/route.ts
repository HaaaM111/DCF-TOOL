import { NextRequest } from "next/server";
import { guardRequest,jsonError,jsonOk } from "@/lib/api";
import { idSchema } from "@/lib/agent/schemas";
import { metricsSchema,readMetrics } from "@/lib/financial-metrics";
import { prisma } from "@/lib/prisma";
import { writeAppSetting } from "@/lib/app-setting-write";
import { companyAccessWhere } from "@/lib/auth";
export async function GET(req:NextRequest,{ params: pendingParams }: { params: Promise<{id:string}> }) {
 const params=await pendingParams;
 const guard=await guardRequest(req);if(guard)return guard;
 if(!idSchema.safeParse(params.id).success)return jsonError("无效id",422);
 if(!await prisma.company.findFirst({where:companyAccessWhere(req,params.id),select:{id:true}}))return jsonError("标的不存在",404);
 return jsonOk({metrics:await readMetrics(params.id)});
}
export async function POST(req:NextRequest,{ params: pendingParams }: { params: Promise<{id:string}> }) {
 const params=await pendingParams;
 const guard=await guardRequest(req);if(guard)return guard;
 if(!idSchema.safeParse(params.id).success)return jsonError("无效id",422);
 const parsed=metricsSchema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return jsonError("指标需包含报告期、来源、人民币亿元口径和有限数值",422);
 if(!await prisma.company.findFirst({where:companyAccessWhere(req,params.id),select:{id:true}}))return jsonError("标的不存在",404);
 const key=`financial_metrics:${params.id}`;await writeAppSetting(prisma,key,JSON.stringify(parsed.data));return jsonOk({metrics:parsed.data});
}
