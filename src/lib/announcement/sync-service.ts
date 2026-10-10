/**
 * 公告同步共享服务（供 sync 路由与智能体工具共用）
 * ------------------------------------------------------------------
 * 流程：读标的 → 巨潮 orgId → 拉近 N 天公告 → 按 (companyId, source, code) 去重
 *      → 逐个下载 PDF 提取文本 → 标题分类 → 入库（仅采集，不做信号分析）
 * 分析职责：已迁移至智能体（analyze_announcements 工具 → analyze-service），
 *           公告中心不再自动批量分析。
 * 设计：单公告失败不影响整批（failed 列表返回）；幂等（唯一键）；部分成功不抛错。
 * 抛错仅用于不可恢复的整批失败（标的不存在/代码无法解析/orgId 查不到/巨潮接口异常）。
 */
import { prisma } from "@/lib/prisma";
import {
  fetchOrgId,
  fetchAnnouncements,
  type Market,
} from "@/lib/announcement/cninfo-client";
import { extractPdfText, classify } from "@/lib/announcement/parser";

export interface SyncResult {
  fetched: number;
  added: number;
  failed: { code: string; title: string; reason: string }[];
}

/** 整批失败的领域错误：message 可直达用户，status/code 用于 HTTP 映射 */
export class SyncServiceError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 500, code = "SYNC_FAILED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_DAYS = 30;
const BATCH_SLEEP_MS = 300; // 请求间礼貌间隔

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 按需同步某公司公告（仅采集入库）；days 会被钳制在 [1, 90] */
export async function syncCompanyAnnouncements(
  companyId: string,
  days = DEFAULT_DAYS,
): Promise<SyncResult> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    throw new SyncServiceError("标的不存在", 404, "COMPANY_NOT_FOUND");
  }

  // ticker 形如 600104.SH / 000001.SZ
  const m = /^(\d{6})\.(SH|SZ)$/i.exec(company.ticker);
  if (!m) {
    throw new SyncServiceError(
      `无法解析股票代码：${company.ticker}（需形如 000001.SZ）`,
      422,
      "BAD_TICKER",
    );
  }
  const secCode = m[1];
  const market: Market = m[2].toUpperCase() === "SH" ? "SH" : "SZ";

  const clampedDays = Math.min(90, Math.max(1, days || DEFAULT_DAYS));
  const now = new Date();
  const from = new Date(now.getTime() - clampedDays * 24 * 3600 * 1000);

  const orgId = await fetchOrgId(secCode);
  if (!orgId) {
    throw new SyncServiceError(`巨潮未找到 ${secCode} 的 orgId`, 404, "ORGID_NOT_FOUND");
  }

  const fetched = await fetchAnnouncements(secCode, orgId, market, fmtDate(from), fmtDate(now));
  if (!fetched.length) {
    return { fetched: 0, added: 0, failed: [] };
  }

  // 按唯一键 (companyId, source, code) 去重
  const existing = await prisma.announcement.findMany({
    where: {
      companyId,
      source: "cninfo",
      code: { in: fetched.map((a) => a.announcementId) },
    },
    select: { code: true },
  });
  const existingSet = new Set(existing.map((e) => e.code));
  const newOnes = fetched.filter((a) => !existingSet.has(a.announcementId));

  let added = 0;
  const failed: { code: string; title: string; reason: string }[] = [];

  for (const a of newOnes) {
    try {
      const rawText = await extractPdfText(a.pdfUrl, a.adjunctSizeKb);
      const { category } = classify(a.title);

      await prisma.announcement.create({
        data: {
          companyId,
          source: "cninfo",
          code: a.announcementId,
          title: a.title,
          publishAt: a.publishAt,
          category,
          pdfUrl: a.pdfUrl,
          rawText,
        },
      });

      added += 1;
      await sleep(BATCH_SLEEP_MS);
    } catch (e) {
      failed.push({
        code: a.announcementId,
        title: a.title,
        reason: e instanceof Error ? e.message : "未知错误",
      });
    }
  }

  return { fetched: fetched.length, added, failed };
}
