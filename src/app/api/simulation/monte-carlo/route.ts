/**
 * POST /api/simulation/monte-carlo
 * 对 DCF 关键参数进行蒙特卡洛采样，输出目标价置信区间。
 * 入参：assumptions + company 基础数据 + samples（可选）
 * 出参：P5/P25/中位数/P75/P95 + 直方图 + 市价百分位
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { runMonteCarlo } from "@/lib/monte-carlo";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  assumptions: z.object({
    baseFcf: z.number(),
    g1: z.number(),
    g2: z.number(),
    g3: z.number(),
    perpetualG: z.number(),
    ke: z.number(),
    payoutRate1: z.number(),
    payoutRate2: z.number(),
    e1: z.number(),
    e2: z.number(),
    e3: z.number(),
    reverseR: z.number(),
    exitPe: z.number(),
    transitionG: z.number(),
    terminalProfitEst: z.number(),
  }),
  company: z.object({
    currentPrice: z.number(),
    shares: z.number(),
    netCash: z.number(),
    e0: z.number(),
  }),
  samples: z.number().int().min(100).max(50000).default(10000),
});

export async function POST(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("请求体不是合法的 JSON", 400, "INVALID_JSON");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      `参数校验失败：${parsed.error.issues.map((i) => i.message).join("；")}`,
      422,
      "VALIDATION_ERROR",
    );
  }

  const { assumptions, company, samples } = parsed.data;

  // 限制单次最大采样数，防止服务器资源耗尽
  const result = runMonteCarlo(assumptions, company, { samples });

  return jsonOk({ result });
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
