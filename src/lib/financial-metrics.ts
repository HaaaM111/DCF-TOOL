import { z } from "zod";
import { prisma } from "@/lib/prisma";
export const metricsSchema=z.object({ebit:z.number().finite().nullable(),ebitda:z.number().finite().nullable(),period:z.string().regex(/^\d{4}-(FY|H1|Q[1-4]|TTM)$/),currency:z.literal("CNY"),unit:z.literal("亿元"),source:z.string().trim().min(1).max(500)}).strict();
export async function readMetrics(companyId:string){const row=await prisma.appSetting.findUnique({where:{key:`financial_metrics:${companyId}`}});if(!row)return null;try{return metricsSchema.parse(JSON.parse(row.value));}catch{return null;}}
