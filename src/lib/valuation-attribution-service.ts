import "server-only";
import { resolvePriceHistory } from "./data-source";
import { calcForwardDcf } from "./dcf";
import { chinaMarketDate } from "./financial-data-quality";
import { industryForIssuer } from "./industry-catalog";
import { readIndustrySnapshot } from "./industry-library";
import { comparableFromSample, industryNameSchema } from "./industry-snapshot";
import { getOperatingPublication, getOperatingRevision } from "./operating-model-store";
import { calculateOperatingValuation } from "./operating-valuation";
import { mainlandCloseWindow } from "./peer-selection";
import { selectPrimaryValuation } from "./primary-valuation";
import { prisma } from "./prisma";
import { compareMultiples } from "./relative-multiples";
import { assumptionsSchema } from "./validation";
import {
  compareAttributionPrice, comparableEvidence, type AttributionModel, type MarketClose, type ValuationAttributionEvidence,
} from "./valuation-attribution";

function listedCurrency(ticker: string) {
  if (/\.HK$/i.test(ticker)) return "HKD";
  return /\.(SH|SZ|BJ)$/i.test(ticker) ? "CNY" : null;
}

async function latestClose(ticker: string, currency: string | null): Promise<MarketClose | null> {
  if (!currency) return null;
  const offset = currency === "HKD" ? 3600_000 : 0;
  const { start, end } = mainlandCloseWindow(new Date(Date.now() - offset));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const history = await Promise.race([
      resolvePriceHistory(ticker, start, end),
      new Promise<null>((done) => { timer = setTimeout(() => done(null), 5000); }),
    ]);
    if (!history || history.source === "mock") return null;
    const bar = history.data.filter(({ date, close }) => date >= start && date <= end && Number.isFinite(close) && close > 0)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return bar ? { price: bar.close, date: bar.date, currency, source: history.source } : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sensitivity(rate: number, growth: number, priceAt: (rate: number, growth: number) => number) {
  const changes = [
    { driver: "rate", shift: -.01 }, { driver: "rate", shift: .01 },
    { driver: "growth", shift: -.005 }, { driver: "growth", shift: .005 },
  ] as const;
  return changes.flatMap(({ driver, shift }) => {
    const nextRate = driver === "rate" ? rate + shift : rate;
    const nextGrowth = driver === "growth" ? growth + shift : growth;
    if (nextRate < .001 || nextRate > 1 || nextGrowth < -.99 || nextRate - nextGrowth < .0001) return [];
    const price = priceAt(nextRate, nextGrowth);
    return Number.isFinite(price) ? [{ driver, shift, price }] : [];
  });
}

async function peerContext(company: { ticker: string; name: string; industry: string }, quote: MarketClose | null) {
  const industry = industryForIssuer(company);
  if (!industry || !industryNameSchema.safeParse(industry).success || quote?.currency !== "CNY") return null;
  const snapshot = await readIndustrySnapshot(industry, quote.date);
  const subject = snapshot?.samples.find((sample) => sample.ticker === company.ticker.toUpperCase());
  if (!subject || !snapshot) return null;
  const peers = snapshot.samples.filter((sample) => sample !== subject);
  const { methods } = compareMultiples(comparableFromSample(subject, industry),
    peers.map((sample) => comparableFromSample(sample, industry)));
  const multiples = methods.flatMap(({ name, current, median, count }) =>
    count >= 3 && current !== null && median !== null ? [{ name, current, median, count }] : []);
  return multiples.length ? { industry, date: snapshot.date, period: snapshot.period, names: peers.map(({ name }) => name), multiples } : null;
}

async function recentDisclosures(companyId: string, quote: MarketClose | null, modelCutoff: string | null) {
  const close = quote ? new Date(`${quote.date}T${quote.currency === "HKD" ? "16" : "15"}:00:00+08:00`) : new Date();
  const rows = await prisma.announcement.findMany({
    where: { companyId, source: { in: ["cninfo", "sse"] }, publishAt: {
      lte: close, gte: new Date(close.getTime() - 90 * 86400_000),
    } },
    orderBy: { publishAt: "desc" }, take: 5, select: { title: true, publishAt: true, rawText: true },
  });
  return rows.map((row) => {
    const date = chinaMarketDate(row.publishAt);
    return { title: row.title.trim().slice(0, 120), date,
      excerpt: row.rawText?.replace(/\s+/g, " ").trim().slice(0, 300) || null,
      afterModelCutoff: modelCutoff ? date > modelCutoff : null };
  });
}

export async function loadAttributionEvidence(companyId: string): Promise<ValuationAttributionEvidence | null> {
  const [company, snapshot, publication] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }),
    prisma.companySnapshot.findUnique({ where: { companyId } }),
    getOperatingPublication(companyId),
  ]);
  if (!company) return null;
  const primary = selectPrimaryValuation({ ...company, targetPrice: snapshot?.targetPrice }, publication);
  const native = listedCurrency(company.ticker);
  const close = await latestClose(company.ticker, native);
  let quote = close;
  let model: AttributionModel | null = null;
  let terminalGrowth: number | null = null;
  let reconciliation: ValuationAttributionEvidence["reconciliation"] = "unverified";
  let comparables: ValuationAttributionEvidence["comparables"] = null;
  let alignedEligible = false;
  let referenceReason = "估值锚点和收盘日不同，价格仅作跨期对照";
  let valuationDate = snapshot?.lastEvalDate ? chinaMarketDate(snapshot.lastEvalDate) : null;

  if (primary.kind === "operating") {
    const p = primary.publication;
    valuationDate = p.valuationDate;
    if (p.retrospective) referenceReason = "底稿包含估值锚点后取得的资料，价格仅作跨期对照";
    const input = await getOperatingRevision(companyId, p.revision).catch(() => null);
    if (input) {
      const result = calculateOperatingValuation(input);
      if (result.reconciliation.passed && Math.abs(result.prices.reoi - primary.price) <= result.reconciliation.tolerance) {
        reconciliation = "passed";
        terminalGrowth = input.terminalGrowth;
        if (!quote && native === p.currency && result.marketComparable && p.comparableQuote === input.quote?.price) {
          quote = { price: p.comparableQuote!, date: p.valuationDate, currency: p.currency, source: "published" };
        }
        const alignedResult = quote && quote.currency === p.currency && quote.date === p.valuationDate && !p.retrospective
          ? calculateOperatingValuation({ ...input, quote: { date: quote.date, price: quote.price, source: quote.source } }) : null;
        alignedEligible = alignedResult?.marketComparable === true;
        if (quote?.date === p.valuationDate && !alignedEligible && !p.retrospective) referenceReason = "底稿的时点或资料条件尚未满足同日比较";
        const { terminal, bridge, rows } = result;
        model = { kind: "operating", currency: p.currency, rate: input.wacc, growth: input.terminalGrowth,
          explicitPerShare: (bridge.operatingValue - terminal.pvOperatingTerminal) / input.shares,
          terminalPerShare: terminal.pvOperatingTerminal / input.shares, terminalShare: terminal.operatingValueShare,
          netFinancialAssetsPerShare: -bridge.netFinancialObligations / input.shares,
          minorityPerShare: -bridge.minorityInterest / input.shares, retainedPerShare: null,
          forecasts: rows.map(({ year, income, reinvestment, fcff }) => ({ year, income, reinvestment, cashFlow: fcff })),
          impliedGrowth: alignedEligible ? alignedResult?.impliedGrowth ?? null : null,
          sensitivity: sensitivity(input.wacc, input.terminalGrowth,
            (wacc, growth) => calculateOperatingValuation({ ...input, wacc, terminalGrowth: growth }).prices.reoi),
        };
      }
    }
    if (primary.upside !== null) {
      const report = await prisma.valuationReport.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" }, select: { id: true } });
      const row = report ? await prisma.appSetting.findUnique({ where: { key: `validation_details:${report.id}` } }) : null;
      if (row) {
        try { comparables = comparableEvidence(primary, JSON.parse(row.value)); } catch { /* Ignore older malformed records. */ }
      }
    }
  } else if (primary.kind === "legacy" && native === "CNY") {
    referenceReason = "简化股东回报模型的市场数据未随底稿冻结，价格仅作参考对照";
    const saved = assumptionsSchema.safeParse(await prisma.assumption.findUnique({ where: { companyId } }));
    if (saved.success) {
      const a = saved.data;
      try {
        const f = calcForwardDcf(a, company, { requireFinite: true });
        if (Math.abs(f.adjustedTargetPrice - primary.price) <= Math.max(1e-8, Math.abs(primary.price) * 1e-9)) {
          model = { kind: "legacy", currency: native, rate: a.ke, growth: a.perpetualG,
            explicitPerShare: f.composition.explicit / company.shares, terminalPerShare: f.composition.terminal / company.shares,
            terminalShare: f.composition.total > 0 ? f.composition.terminal / f.composition.total : null,
            netFinancialAssetsPerShare: f.composition.netCash / company.shares,
            minorityPerShare: null, retainedPerShare: f.composition.retainedCash / company.shares, impliedGrowth: null,
            forecasts: f.rows.map(({ year, fcf }) => ({ year, income: null, reinvestment: null, cashFlow: fcf })),
            sensitivity: sensitivity(a.ke, a.perpetualG, (ke, perpetualG) =>
              calcForwardDcf({ ...a, ke, perpetualG }, company).adjustedTargetPrice),
          };
        }
      } catch { /* Keep the saved value as a reference, without a direction claim. */ }
    }
  }
  const comparison = compareAttributionPrice({
    price: primary.price, currency: primary.kind === "operating" ? primary.publication.currency : model?.currency ?? null,
    valuationDate, verified: model !== null, quote, alignedEligible, referenceReason,
  });
  const [peers, announcements] = await Promise.all([
    peerContext(company, quote).catch(() => null),
    recentDisclosures(companyId, quote, primary.kind === "operating" ? primary.publication.informationCutoff : null).catch(() => []),
  ]);
  return { ticker: company.ticker, companyName: company.name, primary, terminalGrowth, reconciliation,
    comparables, comparison, model, peers, announcements };
}
