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
  const guard = await guardRequest(req);
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

  const result = runMonteCarlo(assumptions, company, { samples });

  return jsonOk({ result });
}

export async function OPTIONS(req: NextRequest) {
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
