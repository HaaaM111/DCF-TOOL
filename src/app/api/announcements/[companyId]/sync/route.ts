/**
 * POST /api/announcements/[companyId]/sync —— 公告智能体按需主入口
 * ------------------------------------------------------------------
 * 核心逻辑在 src/lib/announcement/sync-service.ts（与智能体工具共用）；
 * 本路由只做：请求守卫 → 参数解析 → 调用服务 → HTTP 错误映射。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import {
  syncCompanyAnnouncements,
  SyncServiceError,
} from "@/lib/announcement/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string } },
) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const sp = req.nextUrl.searchParams;
  const days =
    parseInt(sp.get("days") ?? String(DEFAULT_DAYS), 10) || DEFAULT_DAYS;

  try {
    const result = await syncCompanyAnnouncements(params.companyId, days);
    return jsonOk(result);
  } catch (e) {
    console.error("[announcements/sync] unhandled:", e);
    if (e instanceof SyncServiceError) {
      return jsonError(e.message, e.status, e.code);
    }
    return jsonError(
      `公告同步失败：${e instanceof Error ? e.message : "未知错误"}`,
      500,
      "SYNC_FAILED",
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
