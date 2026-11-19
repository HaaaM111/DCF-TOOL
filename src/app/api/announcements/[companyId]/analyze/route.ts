import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { readLlmDbSettings } from "@/lib/llm-settings";
import { analyzeCompanyAnnouncements } from "@/lib/announcement/analyze-service";
import { companyAccessWhere, getAuthenticatedUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params: pendingParams }: { params: Promise<{ companyId: string }> },
) {
  const params = await pendingParams;
  const guard = await guardRequest(req);
  if (guard) return guard;

  let announcementIds: string[] | undefined;
  try {
    const body = (await req.json().catch(() => null)) as {
      announcementIds?: unknown;
    } | null;
    if (body && Array.isArray(body.announcementIds)) {
      announcementIds = body.announcementIds
        .filter((x): x is string => typeof x === "string")
        .slice(0, 50);
    }
  } catch {
    /* 无 body 或格式错误：分析全部未分析公告 */
  }

  try {
    const company = await prisma.company.findFirst({ where: companyAccessWhere(req, params.companyId) });
    if (!company) {
      return jsonError("标的不存在", 404, "COMPANY_NOT_FOUND");
    }
    const dbCfg = await readLlmDbSettings();
    const result = await analyzeCompanyAnnouncements(params.companyId, {
      announcementIds,
      config: dbCfg,
    });
    return jsonOk(result);
  } catch (e) {
    return jsonError(
      `公告分析失败：${e instanceof Error ? e.message : "未知错误"}`,
      500,
      "ANALYZE_FAILED",
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
