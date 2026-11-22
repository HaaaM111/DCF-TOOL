import "server-only";
import { industryForIssuer } from "./industry-catalog";
import { getIndustryData } from "./industry-library";
import { comparableFromSample, industryNameSchema } from "./industry-snapshot";
import { compareMultiples, type Comparable } from "./relative-multiples";

type Company = { id: string; ticker: string; name: string; industry: string };

export async function calculatePeerValuation(company: Company) {
  const ticker = company.ticker.toUpperCase();
  const industry = industryForIssuer(company);
  let library = industry && industryNameSchema.safeParse(industry).success
    ? await getIndustryData(industry) : null;
  const hasTicker = (data: NonNullable<typeof library>) =>
    data.snapshot?.samples.some((item) => item.ticker === ticker) || data.snapshot?.excluded.some((item) => item.ticker === ticker);
  if (industry && library?.mode === "stored" && !hasTicker(library)) library = await getIndustryData(industry, true);
  const stored = library?.snapshot;
  const own = stored?.samples.find((item) => item.ticker === ticker);
  const subject: Comparable = own && industry ? comparableFromSample(own, industry)
    : { ticker, name: company.name, marketCap: 0, e0: 0, bookValue: 0, revenue: 0 };
  const peers = own && industry ? stored!.samples.filter((item) => item.ticker !== ticker)
    .map((item) => comparableFromSample(item, industry)) : [];
  const multiples = compareMultiples(subject, peers);
  const peerEvidence = [
    ...(stored?.samples.filter((item) => item.ticker !== ticker).map((item) => ({
      ticker: item.ticker, name: item.name, reason: item.reason,
      financialSource: item.financialSource, quoteSource: item.quoteSource, excluded: own ? undefined : "标的缺少同口径数据",
    })) ?? []),
    ...(stored?.excluded.filter((item) => item.ticker !== ticker)
      .map((item) => ({ ...item, financialSource: undefined, quoteSource: undefined })) ?? []),
  ];

  return { subject, peers, multiples, evidence: {
    industry: industry ?? "", period: stored?.period ?? null, quoteDate: stored?.date ?? null, currency: "CNY",
    sources: own ? { financial: own.financialSource, quote: own.quoteSource } : null,
    libraryMode: library?.mode ?? null, collectedAt: stored?.collectedAt ?? null,
    unavailableReason: !industry ? "暂无可用的 A 股细分行业，请核对行业分类"
      : !stored ? "资料库暂未取得真实年报与收盘数据"
      : !own ? "标的未取得与行业样本同日、同报告期的数据" : null,
    peerEvidence,
  } };
}
