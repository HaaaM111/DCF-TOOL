/**
 * POST /api/announcements/[companyId]/analyze —— 公告分析入口（智能体工具/快捷按钮共用）
 * ------------------------------------------------------------------
 * 对该公司已采集但未分析的公告生成预期差信号（analyze-service），写回 AnnouncementSignal。
 * 配置来源：env 优先 + DB（页面配置）兜底；未配置 key 时 llmReady=false，不报错。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { readLlmDbSettings } from "@/lib/llm-settings";
import { analyzeCompanyAnnouncements } from "@/lib/announcement/analyze-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string } },
) {
  const guard = guardRequest(req);
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
    const company = await prisma.company.findUnique({ where: { id: params.companyId } });
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
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
