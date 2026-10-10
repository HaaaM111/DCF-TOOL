/**
 * POST /api/announcements/[companyId]/delete —— 批量删除已入库公告
 * ------------------------------------------------------------------
 * body: { ids: string[] }（公告记录 id）；关联预期差信号级联删除。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { deleteAnnouncements } from "@/lib/announcement/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  let body: { ids?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("请求体必须是 JSON", 400, "BAD_BODY");
  }
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((i): i is string => typeof i === "string")
    : [];
  if (!ids.length) {
    return jsonError("缺少 ids（待删除的公告 id 列表）", 400, "BAD_BODY");
  }

  try {
    const result = await deleteAnnouncements(ids);
    return jsonOk(result);
  } catch (e) {
    return jsonError(
      `公告删除失败：${e instanceof Error ? e.message : "未知错误"}`,
      500,
      "DELETE_FAILED",
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
