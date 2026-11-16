import { prisma } from "@/lib/prisma";
import {
  fetchOrgId,
  fetchAnnouncements,
  type CninfoAnnouncement,
  type Market,
} from "@/lib/announcement/cninfo-client";
import { extractPdfText, classify } from "@/lib/announcement/parser";

export interface AnnouncementCandidate {
  code: string;
  title: string;
  publishAt: Date;
  category: string;
  pdfUrl: string;
  adjunctSizeKb: number;
}

export interface FetchResult {
  fetched: number;
  candidates: AnnouncementCandidate[];
  cached: boolean;
}

export interface StoreResult {
  stored: number;
  skipped: number;
  failed: { code: string; title: string; reason: string }[];
}

export interface SyncResult {
  fetched: number;
  added: number;
  failed: { code: string; title: string; reason: string }[];
}

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
const BATCH_SLEEP_MS = 300;
const CANDIDATE_TTL_MS = 10 * 60 * 1000;
const CANDIDATE_MAX_COMPANIES = 200;

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

export async function storeCompanyAnnouncements(
  companyId: string,
  codes: string[],
): Promise<StoreResult> {
  const codeSet = new Set(codes.map((c) => String(c).trim()).filter(Boolean));
  if (!codeSet.size) {
    return { stored: 0, skipped: 0, failed: [] };
  }

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
  const skipped = Math.max(0, codeSet.size - targets.length);

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
      continue;
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

export async function syncCompanyAnnouncements(
  companyId: string,
  days = DEFAULT_DAYS,
): Promise<SyncResult> {
  const clampedDays = Math.min(90, Math.max(1, days || DEFAULT_DAYS));
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

export async function deleteAnnouncements(ids: string[]): Promise<{ deleted: number }> {
  const idSet = new Set(ids.map((i) => String(i).trim()).filter(Boolean));
  if (!idSet.size) return { deleted: 0 };
  const res = await prisma.announcement.deleteMany({
    where: { id: { in: Array.from(idSet) } },
  });
  return { deleted: res.count };
}
