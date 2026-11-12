import "server-only";
import { resolveFinancials, resolvePriceHistory } from "./data-source";
import { getIndustryPeers } from "./ifind-client";
import { prisma } from "./prisma";
import { compareMultiples, type Comparable } from "./relative-multiples";
import { readMetrics } from "./financial-metrics";
import { mainlandCloseWindow, normalizeIndustry, selectPeerCandidates, type PeerCandidate } from "./peer-selection";

type Company = { id: string; ticker: string; name: string; industry: string };

async function readSnapshot(ticker: string, name: string, start: string, end: string, id?: string) {
  const [financial, history, metrics] = await Promise.all([
    resolveFinancials(ticker, { includeReportedCash: false }), resolvePriceHistory(ticker, start, end), id ? readMetrics(id) : null,
  ]);
  const facts = financial.data.comparable;
  if (financial.source === "mock" || !facts || facts.shares <= 0
    || !/^\d{4}-12-31$/.test(financial.data.reportDate) || history.source === "mock") return null;
  const quotes = history.data.filter((quote) => quote.date >= start && quote.date <= end && quote.close > 0);
  if (!quotes.length) return null;
  const date = quotes.reduce((latest, quote) => quote.date > latest ? quote.date : latest, start);
  const fundamentals = {
    ticker, name, e0: facts.parentEarnings ?? 0, bookValue: facts.parentBook ?? 0, revenue: financial.data.revenue,
    netCash: facts.netCash,
    ebit: metrics?.period === `${financial.data.reportDate.slice(0, 4)}-FY` ? metrics.ebit ?? undefined : undefined,
    ebitda: metrics?.period === `${financial.data.reportDate.slice(0, 4)}-FY` ? metrics.ebitda ?? undefined : undefined,
  };
  return { fundamentals, quotes, shares: facts.shares, date, reportDate: financial.data.reportDate,
    financialSource: financial.source, quoteSource: history.source };
}

const emptySubject = (subject: Company): Comparable =>
  ({ ticker: subject.ticker, name: subject.name, marketCap: 0, e0: 0, bookValue: 0, revenue: 0 });

export async function calculatePeerValuation(company: Company) {
  const industry = normalizeIndustry(company.industry);
  const ticker = company.ticker.toUpperCase();
  const saved = industry ? await prisma.company.findMany({
    where: { industry: { in: [...new Set([company.industry, industry])] }, id: { not: company.id } },
    orderBy: { ticker: "asc" },
    take: 20,
    select: { id: true, ticker: true, name: true, industry: true },
  }) : [];
  const candidates = selectPeerCandidates(company, [...saved, ...getIndustryPeers(industry, company.ticker)]);
  const peerEvidence: (PeerCandidate & { financialSource?: string; quoteSource?: string; excluded?: string })[] = [];
  const peers: Comparable[] = [];
  let subject = emptySubject(company);
  let period: string | null = null;
  let quoteDate: string | null = null;
  let sources: { financial: string; quote: string } | null = null;
  if (candidates.length) {
    const { start, end } = mainlandCloseWindow(new Date());
    const snapshot = await readSnapshot(ticker, company.name, start, end, company.id).catch(() => null);
    if (snapshot) {
      period = snapshot.reportDate;
      quoteDate = snapshot.date;
      sources = { financial: snapshot.financialSource, quote: snapshot.quoteSource };
      subject = { ...snapshot.fundamentals, marketCap: snapshot.shares * snapshot.quotes.find((q) => q.date === snapshot.date)!.close };
      for (let index = 0; index < candidates.length; index += 3) {
        const batch = candidates.slice(index, index + 3);
        const resolved = await Promise.all(batch.map(async (p) => ({
          candidate: p, data: await readSnapshot(p.ticker, p.name, start, end, saved.find((row) => row.ticker.toUpperCase() === p.ticker)?.id).catch(() => null),
        })));
        for (const { candidate, data } of resolved) {
          const quote = data?.quotes.find((q) => q.date === quoteDate);
          if (!data || data.reportDate !== period || !quote) {
            peerEvidence.push({ ...candidate, excluded: "缺少真实年报或同日行情，或报告期不同" });
            continue;
          }
          peers.push({ ...data.fundamentals, marketCap: data.shares * quote.close });
          peerEvidence.push({ ...candidate, financialSource: data.financialSource, quoteSource: data.quoteSource });
        }
      }
    } else {
      peerEvidence.push(...candidates.map((candidate) => ({ ...candidate, excluded: "标的缺少可核验年报或收盘行情" })));
    }
  }
  const multiples = compareMultiples(subject, peers);
  return { subject, peers, multiples, evidence: {
    industry: ticker === "603786.SH" ? "汽车电子" : industry,
    period, quoteDate, currency: "CNY", sources, peerEvidence,
  } };
}
