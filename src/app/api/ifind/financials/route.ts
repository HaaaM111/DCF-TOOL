/**
 * 财务数据代理（独立路由，分流模式）
 * GET /api/ifind/financials?ticker=600104.SH
 * 返回：cfo / capex / da / e0 / shares / debt / totalAssets 等（单位：亿元）
 * 数据链路：iFinD（权威）→ 东财（免费兜底，仅 A 股）→ mock
 * 兜底不完整时 incomplete=true
 *
 * 安全：Token 仅在服务端使用，绝不返回前端。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { resolveFinancials } from "@/lib/data-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const ticker = req.nextUrl.searchParams.get("ticker")?.trim() ?? "";
  if (!ticker) {
    return jsonError("缺少 ticker 参数", 400, "MISSING_TICKER");
  }

  try {
    const { data, source } = await resolveFinancials(ticker);
    return jsonOk({
      data,
      source,
      mock: source === "mock",
      incomplete: data.incomplete ?? false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "财务数据获取失败";
    return jsonError(msg, 502, "FINANCIALS_ERROR");
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
