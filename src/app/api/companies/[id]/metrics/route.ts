import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { guardRequest,jsonError,jsonOk } from "@/lib/api";
import { idSchema } from "@/lib/agent/schemas";
import { metricsSchema,readMetrics } from "@/lib/financial-metrics";
import { prisma } from "@/lib/prisma";
export async function GET(req:NextRequest,{ params: pendingParams }: { params: Promise<{id:string}> }) {
 const params=await pendingParams;
 if(!Object.values(params).every(x=>idSchema.safeParse(x).success))return NextResponse.json({error:"路径参数无效"},{status:422});const guard=guardRequest(req);if(guard)return guard;if(!idSchema.safeParse(params.id).success)return jsonError("无效id",422);return jsonOk({metrics:await readMetrics(params.id)});}
export async function POST(req:NextRequest,{ params: pendingParams }: { params: Promise<{id:string}> }) {
 const params=await pendingParams;
 if(!Object.values(params).every(x=>idSchema.safeParse(x).success))return NextResponse.json({error:"路径参数无效"},{status:422});const guard=guardRequest(req);if(guard)return guard;if(!idSchema.safeParse(params.id).success)return jsonError("无效id",422);const parsed=metricsSchema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return jsonError("指标需包含报告期、来源、人民币亿元口径和有限数值",422);if(!await prisma.company.findUnique({where:{id:params.id}}))return jsonError("标的不存在",404);const key=`financial_metrics:${params.id}`;await prisma.appSetting.upsert({where:{key},create:{key,value:JSON.stringify(parsed.data)},update:{value:JSON.stringify(parsed.data)}});return jsonOk({metrics:parsed.data});}
