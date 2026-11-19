/**
 * 公告同步共享服务（供公告中心候选拉取/批量存储、智能体工具共用）
 * ------------------------------------------------------------------
 * 三种模式：
 *   1. fetchCompanyAnnouncements —— 拉取候选（不入库），结果缓存 10 分钟，
 *      公告中心「拉取公告」按钮使用；刷新页面候选丢失（前端不持有）。
 *   2. storeCompanyAnnouncements —— 按 code 列表把候选正式入库（PDF 提取+去重），
 *      公告中心「存储选中」使用；已存在公告跳过。
 *   3. syncCompanyAnnouncements —— 拉取+全部入库（智能体 sync_announcements 工具使用）。
 * 设计：单公告失败不影响整批（failed 列表返回）；幂等（唯一键）；部分成功不抛错。
 * 抛错仅用于不可恢复的整批失败（标的不存在/代码无法解析/orgId 查不到/巨潮接口异常）。
 */
import { prisma } from "@/lib/prisma";
import {
  fetchOrgId,
  fetchAnnouncements,
  type CninfoAnnouncement,
  type Market,
} from "@/lib/announcement/cninfo-client";
import { extractPdfText, classify } from "@/lib/announcement/parser";

/** 候选公告（拉取后未入库，供前端选择） */
export interface AnnouncementCandidate {
  code: string; // 巨潮 announcementId（去重键）
  title: string;
  publishAt: Date;
  category: string; // 标题规则分类
  pdfUrl: string;
  adjunctSizeKb: number;
}

export interface FetchResult {
  fetched: number; // 接口拉取到的公告总数
  candidates: AnnouncementCandidate[];
  cached: boolean; // 本次是否命中候选缓存（重复拉取时）
}

export interface StoreResult {
  stored: number; // 本次成功入库数
  skipped: number; // 已存在（去重）跳过数
  failed: { code: string; title: string; reason: string }[];
}

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
const CANDIDATE_TTL_MS = 10 * 60 * 1000; // 候选缓存 10 分钟
const CANDIDATE_MAX_COMPANIES = 200; // 防内存泄漏上限

/** 候选缓存：companyId -> { candidates, at }（单实例内存；重启/多实例失效） */
const candidateCache = new Map<
  string,
  { candidates: AnnouncementCandidate[]; at: number }
>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 解析 ticker → secCode/market；失败抛 SyncServiceError */
async function resolveCompany(
  companyId: string,
  days: number,
): Promise<{
  secCode: string;
  market: Market;
  from: Date;
  to: Date;
  days: number;
}> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    throw new SyncServiceError("标的不存在", 404, "COMPANY_NOT_FOUND");
  }
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
  const now = new Date();
  return {
    secCode,
    market,
    from: new Date(now.getTime() - days * 24 * 3600 * 1000),
    to: now,
    days,
  };
}

function toCandidate(a: CninfoAnnouncement): AnnouncementCandidate {
  const { category } = classify(a.title);
  return {
    code: a.announcementId,
    title: a.title,
    publishAt: a.publishAt,
    category,
    pdfUrl: a.pdfUrl,
    adjunctSizeKb: a.adjunctSizeKb,
  };
}

function cacheGet(companyId: string): AnnouncementCandidate[] | null {
  const hit = candidateCache.get(companyId);
  if (!hit) return null;
  if (Date.now() - hit.at > CANDIDATE_TTL_MS) {
    candidateCache.delete(companyId);
    return null;
  }
  return hit.candidates;
}

function cachePut(companyId: string, candidates: AnnouncementCandidate[]): void {
  if (candidateCache.size >= CANDIDATE_MAX_COMPANIES) {
    // 简单淘汰：清掉最旧的一条
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of Array.from(candidateCache.entries())) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey) candidateCache.delete(oldestKey);
  }
  candidateCache.set(companyId, { candidates, at: Date.now() });
}

/**
 * 拉取某公司最近 N 天公告（仅候选，不入库；命中缓存时直接返回缓存）。
 * days 会被钳制在 [1, 90]。
 */
export async function fetchCompanyAnnouncements(
  companyId: string,
  days = DEFAULT_DAYS,
): Promise<FetchResult> {
  const clampedDays = Math.min(90, Math.max(1, days || DEFAULT_DAYS));
  const cached = cacheGet(companyId);
  if (cached) {
    return { fetched: cached.length, candidates: cached, cached: true };
  }

  const { secCode, market, from, to } = await resolveCompany(companyId, clampedDays);
  const orgId = await fetchOrgId(secCode);
  if (!orgId) {
    throw new SyncServiceError(`巨潮未找到 ${secCode} 的 orgId`, 404, "ORGID_NOT_FOUND");
  }

  const fetched = await fetchAnnouncements(secCode, orgId, market, fmtDate(from), fmtDate(to));
  const candidates = fetched.map(toCandidate);
  cachePut(companyId, candidates);
  return { fetched: candidates.length, candidates, cached: false };
}

/**
 * 批量存储候选公告（按 code 列表正式入库）。
 * 候选来源：缓存优先；缓存缺失时重新拉取巨潮匹配。
 * 已存在（companyId+source+code）的公告跳过（幂等）。
 */
export async function storeCompanyAnnouncements(
  companyId: string,
  codes: string[],
): Promise<StoreResult> {
  const codeSet = new Set(codes.map((c) => String(c).trim()).filter(Boolean));
  if (!codeSet.size) {
    return { stored: 0, skipped: 0, failed: [] };
  }

  // 候选来源：缓存优先；缺失时拉取匹配
  let candidates = cacheGet(companyId);
  if (!candidates) {
    const { secCode, market, from, to } = await resolveCompany(companyId, DEFAULT_DAYS);
    const orgId = await fetchOrgId(secCode);
    if (!orgId) {
      throw new SyncServiceError(`巨潮未找到 ${secCode} 的 orgId`, 404, "ORGID_NOT_FOUND");
    }
    const fetched = await fetchAnnouncements(secCode, orgId, market, fmtDate(from), fmtDate(to));
    candidates = fetched.map(toCandidate);
    cachePut(companyId, candidates);
  }

  const targets = candidates.filter((c) => codeSet.has(c.code));
  const skipped = Math.max(0, codeSet.size - targets.length); // 请求了但候选里没有的

  // 去重：候选里已入库的也跳过
  const existing = await prisma.announcement.findMany({
    where: {
      companyId,
      source: "cninfo",
      code: { in: targets.map((c) => c.code) },
    },
    select: { code: true },
  });
  const existingSet = new Set(existing.map((e) => e.code));

  let stored = 0;
  const failed: { code: string; title: string; reason: string }[] = [];

  for (const c of targets) {
    if (existingSet.has(c.code)) {
      continue; // 已入库，去重跳过
    }
    try {
      const rawText = await extractPdfText(c.pdfUrl, c.adjunctSizeKb);
      await prisma.announcement.create({
        data: {
          companyId,
          source: "cninfo",
          code: c.code,
          title: c.title,
          publishAt: c.publishAt,
          category: c.category,
          pdfUrl: c.pdfUrl,
          rawText,
        },
      });
      stored += 1;
      await sleep(BATCH_SLEEP_MS);
    } catch (e) {
      failed.push({
        code: c.code,
        title: c.title,
        reason: e instanceof Error ? e.message : "未知错误",
      });
    }
  }

  return { stored, skipped: skipped + (targets.length - stored - failed.length), failed };
}

/**
 * 智能体工具模式：拉取 + 全部入库（同步历史语义）。
 * 复用 fetch（候选）+ store（全部 codes），等价于原 syncCompanyAnnouncements。
 */
export async function syncCompanyAnnouncements(
  companyId: string,
  days = DEFAULT_DAYS,
): Promise<SyncResult> {
  const clampedDays = Math.min(90, Math.max(1, days || DEFAULT_DAYS));
  // 先拉候选（清缓存，确保拿到最新），再全部入库
  candidateCache.delete(companyId);
  const { candidates } = await fetchCompanyAnnouncements(companyId, clampedDays);
  if (!candidates.length) {
    return { fetched: 0, added: 0, failed: [] };
  }
  const result = await storeCompanyAnnouncements(
    companyId,
    candidates.map((c) => c.code),
  );
  return {
    fetched: candidates.length,
    added: result.stored,
    failed: result.failed,
  };
}

/** 删除已入库公告（关联信号级联删除）；供公告中心删除选中使用 */
export async function deleteAnnouncements(ids: string[]): Promise<{ deleted: number }> {
  const idSet = new Set(ids.map((i) => String(i).trim()).filter(Boolean));
  if (!idSet.size) return { deleted: 0 };
  const res = await prisma.announcement.deleteMany({
    where: { id: { in: Array.from(idSet) } },
  });
  return { deleted: res.count };
}
