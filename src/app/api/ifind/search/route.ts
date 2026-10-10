/**
 * 股票搜索代理（分流模式）
 * GET /api/ifind/search?keyword=xxx
 * 返回匹配的股票列表 [{ ticker, name, market }]
 *
 * 搜索链路：东财全市场搜索建议（免费）→ 本地预置池兜底。
 * 东财支持中文名/拼音/代码，覆盖全市场 A 股 + 港股，不再受本地池限制。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { searchEastSuggest, isEastMoneyEnabled } from "@/lib/eastmoney-client";
import { searchStock } from "@/lib/ifind-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const keyword = req.nextUrl.searchParams.get("keyword")?.trim() ?? "";
  if (!keyword) {
    return jsonError("缺少 keyword 参数", 400, "MISSING_KEYWORD");
  }

  // 关键词长度安全限制，防止过宽搜索打挂上游
  if (keyword.length > 32) {
    return jsonError("关键词过长", 400, "KEYWORD_TOO_LONG");
  }

  try {
    let data: { ticker: string; name: string; market?: string }[];

    // 1) 东财全市场搜索（免费，主通道）
    if (isEastMoneyEnabled()) {
      data = await searchEastSuggest(keyword);
      // 东财无结果（或接口异常已抛出）时，落到本地预置池
      if (data.length === 0) {
        data = await searchStock(keyword);
      }
    } else {
      // 东财被显式关闭，直接用本地池
      data = await searchStock(keyword);
    }

    return jsonOk({ data, mock: false });
  } catch (err) {
    // 东财搜索失败时退回本地池，保证搜索始终可用
    try {
      const fallback = await searchStock(keyword);
      return jsonOk({ data: fallback, mock: false });
    } catch {
      const msg = err instanceof Error ? err.message : "搜索失败";
      return jsonError(msg, 502, "IFIND_SEARCH_ERROR");
    }
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
