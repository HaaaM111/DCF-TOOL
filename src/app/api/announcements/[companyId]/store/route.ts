import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { getAuthenticatedUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  storeCompanyAnnouncements,
  SyncServiceError,
} from "@/lib/announcement/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params: pendingParams }: { params: Promise<{ companyId: string }> },
) {
  const params = await pendingParams;
  const guard = await guardRequest(req);
  if (guard) return guard;
  const owned = await prisma.company.findFirst({ where: { id: params.companyId, userId: getAuthenticatedUserId(req) }, select: { id: true } });
  if (!owned) return jsonError("标的不存在", 404, "NOT_FOUND");

  let body: { codes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("请求体必须是 JSON", 400, "BAD_BODY");
  }
  const codes = Array.isArray(body?.codes)
    ? body.codes.filter((c): c is string => typeof c === "string")
    : [];
  if (!codes.length) {
    return jsonError("缺少 codes（待存储的公告编号列表）", 400, "BAD_BODY");
  }

  try {
    const result = await storeCompanyAnnouncements(params.companyId, codes);
    return jsonOk(result);
  } catch (e) {
    console.error("[announcements/store] unhandled:", e);
    if (e instanceof SyncServiceError) {
      return jsonError(e.message, e.status, e.code);
    }
    return jsonError(
      `公告存储失败：${e instanceof Error ? e.message : "未知错误"}`,
      500,
      "STORE_FAILED",
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
