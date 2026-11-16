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

  if (keyword.length > 32) {
    return jsonError("关键词过长", 400, "KEYWORD_TOO_LONG");
  }

  try {
    let data: { ticker: string; name: string; market?: string }[];

    if (isEastMoneyEnabled()) {
      data = await searchEastSuggest(keyword);
      if (data.length === 0) {
        data = await searchStock(keyword);
      }
    } else {
      data = await searchStock(keyword);
    }

    return jsonOk({ data, mock: false });
  } catch (err) {
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
