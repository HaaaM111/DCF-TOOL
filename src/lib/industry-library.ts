import "server-only";
import { writeAppSetting } from "./app-setting-write";
import { resolveFinancials, resolvePriceHistory } from "./data-source";
import { fetchEastAnnualEbit, fetchEastBankParentBook, isEastMoneyEnabled } from "./eastmoney-client";
import { readMetrics } from "./financial-metrics";
import { industryCatalog, isFinancialIndustry } from "./industry-catalog";
import { industryNameSchema, industrySnapshotSchema, type IndustrySample, type IndustrySnapshot } from "./industry-snapshot";
import { mainlandCloseWindow, type PeerCandidate } from "./peer-selection";
import { prisma } from "./prisma";

const ttl = 60 * 60_000;
const memberLimit = 12;
const prefix = (industry: string) => `industry-multiples:v1:${Buffer.from(industry).toString("hex")}:`;
const inFlight = new Map<string, Promise<IndustrySnapshot | null>>();

async function workspaceIssuers() {
  return prisma.company.findMany({
    select: { id: true, ticker: true, name: true, industry: true }, orderBy: { ticker: "asc" },
  });
}

export async function industryDirectory() {
  const groups = industryCatalog(await workspaceIssuers());
  return [...groups].filter(([industry]) => industryNameSchema.safeParse(industry).success)
    .map(([industry, members]) => ({ industry, candidates: Math.min(members.size, memberLimit) }));
}

export async function readIndustrySnapshot(industry: string, date?: string) {
  const row = await prisma.appSetting.findFirst({
    where: { key: { startsWith: prefix(industry) + (date ? date + ":" : "") } }, orderBy: { key: "desc" },
  });
  if (!row) return null;
  try {
    const parsed = industrySnapshotSchema.safeParse(JSON.parse(row.value));
    return parsed.success && parsed.data.industry === industry && (!date || parsed.data.date === date) ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readMember(member: PeerCandidate, start: string, end: string, industry: string, id?: string) {
  const cashRequired = !isFinancialIndustry(industry);
  const [financial, history, metrics] = await Promise.all([
    resolveFinancials(member.ticker, { includeReportedCash: cashRequired }),
    resolvePriceHistory(member.ticker, start, end),
    id ? readMetrics(id) : null,
  ]);
  const data = financial.data;
  const facts = data.comparable;
  if (financial.source === "mock" || history.source === "mock" || !facts || !(facts.shares > 0)
      || !/^\d{4}-12-31$/.test(data.reportDate)) return null;

  const quoteMap = new Map(history.data.filter((quote) => quote.date >= start && quote.date <= end
    && quote.date >= data.reportDate && Number.isFinite(quote.close) && quote.close > 0)
    .map(({ date, close }) => [date, close]));
  if (!quoteMap.size) return null;
  const supplemental = metrics?.period === `${data.reportDate.slice(0, 4)}-FY` ? metrics : null;
  const canBridge = data.cash !== null && Number.isFinite(data.cash) && Number.isFinite(data.debt)
    && !data.missingFields?.includes("debt");
  const netCash = cashRequired ? facts.netCash ?? (canBridge ? data.cash! - data.debt : null) : null;
  const useEast = isEastMoneyEnabled();
  const [bankEquity, statementEbit] = await Promise.all([
    useEast && industry.includes("银行") && facts.parentBook == null
      ? fetchEastBankParentBook(member.ticker, data.reportDate).catch(() => null) : null,
    useEast && netCash !== null && supplemental?.ebit == null
      ? fetchEastAnnualEbit(member.ticker, data.reportDate).catch(() => null) : null,
  ]);
  return {
    quoteMap, period: data.reportDate,
    facts: {
      shares: facts.shares, netIncome: facts.parentEarnings ?? null, equity: facts.parentBook ?? bankEquity,
      equitySource: facts.parentBook != null ? financial.source : bankEquity != null ? "eastmoney" as const : null,
      revenue: data.missingFields?.includes("revenue") ? null : data.revenue, netCash,
      financialSource: financial.source, quoteSource: history.source,
      cashSource: netCash === null ? null : data.cashSource ?? financial.source,
      ebit: supplemental?.ebit ?? statementEbit, ebitda: supplemental?.ebitda ?? null,
      supplementalSource: [supplemental?.source, statementEbit === null ? null : "东方财富年报利润表：利润总额＋费用化利息"]
        .filter(Boolean).join("；") || null,
    },
  };
}

async function collectIndustry(industry: string) {
  const issuers = await workspaceIssuers();
  const members = industryCatalog(issuers).get(industry);
  if (!members?.size) return null;
  const candidates = [...members.values()].slice(0, memberLimit);
  const ids = new Map(issuers.map((row) => [row.ticker.toUpperCase(), row.id]));
  const { start, end } = mainlandCloseWindow(new Date());
  const resolved = [];
  for (let index = 0; index < candidates.length; index += 3) {
    const batch = candidates.slice(index, index + 3);
    resolved.push(...await Promise.all(batch.map(async (candidate) => ({
      candidate, data: await readMember(candidate, start, end, industry, ids.get(candidate.ticker)).catch(() => null),
    }))));
  }
  const periodCounts = new Map<string, number>();
  for (const { data } of resolved) {
    if (data) periodCounts.set(data.period, (periodCounts.get(data.period) ?? 0) + 1);
  }
  const period = [...periodCounts].sort(([a, ac], [b, bc]) => bc - ac || b.localeCompare(a))[0]?.[0];
  if (!period) return null;
  const date = resolved.flatMap(({ data }) => data?.period === period ? [...data.quoteMap.keys()] : []).sort().at(-1);
  if (!date) return null;
  const samples: IndustrySample[] = [];
  const excluded: IndustrySnapshot["excluded"] = [];
  for (const { candidate, data } of resolved) {
    const close = data?.quoteMap.get(date);
    if (!data || data.period !== period || close === undefined) {
      excluded.push({ ...candidate, excluded: !data ? "缺少真实年报、股本或日线" :
        data.period !== period ? "年报期不同" : "未取得同日收盘价" });
      continue;
    }
    samples.push({ ...candidate, ...data.facts, close, marketCap: data.facts.shares * close });
  }
  return industrySnapshotSchema.parse({ industry, date, period, currency: "CNY", collectedAt: new Date().toISOString(), samples, excluded });
}

export async function getIndustryData(industry: string, force = false) {
  const previous = await readIndustrySnapshot(industry);
  if (!force && previous && Date.now() - Date.parse(previous.collectedAt) < ttl) {
    return { snapshot: previous, mode: "stored" as const };
  }
  let refresh = inFlight.get(industry);
  if (!refresh) {
    refresh = collectIndustry(industry).then(async (snapshot) => {
      if (snapshot && previous && snapshot.date === previous.date && snapshot.period === previous.period
          && snapshot.samples.length < previous.samples.length) return null;
      if (snapshot) {
        await writeAppSetting(prisma, `${prefix(industry)}${snapshot.date}:${snapshot.period}`, JSON.stringify(snapshot));
      }
      return snapshot;
    }).finally(() => inFlight.delete(industry));
    inFlight.set(industry, refresh);
  }
  const updated = await refresh.catch(() => null);
  if (updated && (!previous || updated.date >= previous.date)) return { snapshot: updated, mode: "refreshed" as const };
  return { snapshot: previous, mode: "fallback" as const };
}
