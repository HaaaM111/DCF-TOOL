/**
 * POST /api/dcf/calculate
 * 接收模型假设与公司基础数据，后端执行 DCF 计算并返回结果。
 * 安全：
 *   - 速率限制 + CORS
 *   - Zod 校验所有入参
 *   - 后端计算为权威值，前端展示结果必须与此一致（VERIFY_CALCULATION 开关）
 */
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
  const guard = guardRequest(req);
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

  // 入参校验
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

  // 调用纯函数计算引擎
  const output = calcDcf(a, {
    currentPrice: c.currentPrice,
    shares: c.shares,
    netCash: c.netCash,
    e0: c.e0,
  });

  // 分类与诊断（后端权威生成，前端不得自行计算这些标签）
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
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
