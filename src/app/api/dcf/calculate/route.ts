import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { assumptionsSchema, companySchema } from "@/lib/validation";
import {
  calcDcf,
  classifyQuadrant,
  diagnoseNarrative,
} from "@/lib/dcf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("请求体不是合法的 JSON", 400, "INVALID_JSON");
  }

  if (!body || typeof body !== "object") {
    return jsonError("请求体不能为空", 400, "EMPTY_BODY");
  }

  const { assumptions: rawA, company: rawC } = body as Record<string, unknown>;

  const aParsed = assumptionsSchema.safeParse(rawA);
  const cParsed = companySchema.safeParse(rawC);
  if (!aParsed.success || !cParsed.success) {
    const issues = [
      ...(aParsed.success ? [] : aParsed.error.issues.map((i) => `假设: ${i.message}`)),
      ...(cParsed.success ? [] : cParsed.error.issues.map((i) => `公司: ${i.message}`)),
    ];
    return jsonError(`参数校验失败：${issues.join("；")}`, 422, "VALIDATION_ERROR");
  }

  const a = aParsed.data;
  const c = cParsed.data;

  const output = calcDcf(a, {
    currentPrice: c.currentPrice,
    shares: c.shares,
    netCash: c.netCash,
    e0: c.e0,
  });

  const quadrant = classifyQuadrant(output.reverse, a);
  const diagnosis = diagnoseNarrative(output.reverse, output.gordon, {
    currentPrice: c.currentPrice,
    shares: c.shares,
    netCash: c.netCash,
    e0: c.e0,
  });

  return jsonOk({
    ...output,
    quadrant,
    diagnosis,
  });
}

export async function OPTIONS(req: NextRequest) {
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
