import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { companyAccessWhere } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  fetchCompanyAnnouncements,
  SyncServiceError,
} from "@/lib/announcement/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 30;

export async function POST(
  req: NextRequest,
  { params: pendingParams }: { params: Promise<{ companyId: string }> },
) {
  const params = await pendingParams;
  const guard = await guardRequest(req);
  if (guard) return guard;

  const sp = req.nextUrl.searchParams;
  const owned = await prisma.company.findFirst({ where: companyAccessWhere(req, params.companyId), select: { id: true } });
  if (!owned) return jsonError("标的不存在", 404, "NOT_FOUND");
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
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
