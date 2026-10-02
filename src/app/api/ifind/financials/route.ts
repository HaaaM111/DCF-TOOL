/**
 * iFinD 财务数据代理（独立路由）
 * GET /api/ifind/financials?ticker=600104.SH
 * 返回：cfo / capex / da / e0 / shares / debt / totalAssets 等（单位：亿元）
 *
 * 安全：Token 仅在服务端使用，绝不返回前端。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { fetchFinancials, hasIfindCredentials, getMockCompanyData } from "@/lib/ifind-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const ticker = req.nextUrl.searchParams.get("ticker")?.trim() ?? "";
  if (!ticker) {
    return jsonError("缺少 ticker 参数", 400, "MISSING_TICKER");
  }

  const useMock = !hasIfindCredentials();

  try {
    const data = useMock ? getMockCompanyData(ticker) : await fetchFinancials(ticker);
    return jsonOk({ data, mock: useMock });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "财务数据获取失败";
    return jsonError(msg, 502, "IFIND_FINANCIALS_ERROR");
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
