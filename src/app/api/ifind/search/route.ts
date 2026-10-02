/**
 * iFinD 股票搜索代理
 * GET /api/ifind/search?keyword=xxx
 * 返回匹配的股票列表 [{ ticker, name, market }]
 *
 * 安全：Token 仅在服务端使用，绝不返回前端。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import {
  searchStock,
  hasIfindCredentials,
  getMockSearchResults,
} from "@/lib/ifind-client";

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

  const useMock = !hasIfindCredentials();

  try {
    const data = useMock
      ? await getMockSearchResults(keyword)
      : await searchStock(keyword);

    return jsonOk({ data, mock: useMock });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "搜索失败";
    return jsonError(msg, 502, "IFIND_SEARCH_ERROR");
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
