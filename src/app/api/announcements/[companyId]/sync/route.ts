/**
 * POST /api/announcements/[companyId]/sync —— 拉取候选公告（不入库）
 * ------------------------------------------------------------------
 * 拉取该标的最远 N 天公告，返回候选列表；用户勾选后调 /store 正式入库。
 * 候选在服务端缓存 10 分钟（刷新页面后前端候选丢失，需重新拉取）。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import {
  fetchCompanyAnnouncements,
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
  const days = parseInt(sp.get("days") ?? String(DEFAULT_DAYS), 10) || DEFAULT_DAYS;

  try {
    const result = await fetchCompanyAnnouncements(params.companyId, days);
    return jsonOk(result);
  } catch (e) {
    console.error("[announcements/sync] unhandled:", e);
    if (e instanceof SyncServiceError) {
      return jsonError(e.message, e.status, e.code);
    }
    return jsonError(
      `公告拉取失败：${e instanceof Error ? e.message : "未知错误"}`,
      500,
      "SYNC_FAILED",
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
