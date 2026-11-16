
import { calcForwardDcf } from "./dcf";
import type { CompanyBasics, DcfAssumptions } from "@/types/dcf";

const num = (v: number) => (Number.isFinite(v) ? v : 0);

export interface PeerData {
  ticker: string;
  name: string;
  marketCap: number;
  e0: number;
  revenue: number;
  bookValue: number;
}

export interface HistoricalValuationRow {
  year: number;
  pe?: number | null;
  pb?: number | null;
  ps?: number | null;
}

export interface RelativeValuationResult {
  currentPe: number;
  currentPb: number;
  currentPs: number;
  industryPeMean: number;
  industryPeMedian: number;
  industryPbMean: number;
  industryPsMean: number;
  peValue: number;
  pbValue: number;
  psValue: number;
  relativeValue: number;
  premiumDiscount: number;
  peers: { ticker: string; name: string; pe: number; pb: number; ps: number }[];
}

export interface ValidationResult {
  absoluteValue: number;
  relative: RelativeValuationResult;
  relativeValue: number;
  diffRate: number;
  conclusion: "一致" | "偏离";
  pePercentile: number;
  pbPercentile: number;
  psPercentile: number;
}

export interface SensitivityHeatmapCell {
  wacc: number;
  g: number;
  targetPrice: number;
}

function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

function mean(arr: number[]): number {
  const valid = arr.filter((v) => Number.isFinite(v) && v > 0);
  if (valid.length === 0) return 0;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

function median(arr: number[]): number {
  const valid = arr.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0
    ? (valid[mid - 1] + valid[mid]) / 2
    : valid[mid];
}

export function calcPercentile(current: number, history: (number | null | undefined)[]): number {
  const valid = history.filter((v): v is number => Number.isFinite(v as number) && (v as number) > 0);
  if (valid.length === 0) return 50;
  const count = valid.filter((v) => v <= current).length;
  return (count / valid.length) * 100;
}

export function calcRelativeValuation(
  marketCap: number,
  e0: number,
  revenue: number,
  bookValue: number,
  peers: PeerData[],
): RelativeValuationResult {
  const currentPe = safeDiv(marketCap, e0);
  const currentPb = safeDiv(marketCap, bookValue);
  const currentPs = safeDiv(marketCap, revenue);

  const peerMultiples = peers.map((p) => ({
    ticker: p.ticker,
    name: p.name,
    pe: safeDiv(p.marketCap, p.e0),
    pb: safeDiv(p.marketCap, p.bookValue),
    ps: safeDiv(p.marketCap, p.revenue),
  }));

  const industryPeMean = mean(peerMultiples.map((p) => p.pe));
  const industryPeMedian = median(peerMultiples.map((p) => p.pe));
  const industryPbMean = mean(peerMultiples.map((p) => p.pb));
  const industryPsMean = mean(peerMultiples.map((p) => p.ps));

  const peValue = industryPeMean * num(e0);
  const pbValue = industryPbMean * num(bookValue);
  const psValue = industryPsMean * num(revenue);

  const relativeValue = median([peValue, pbValue, psValue]);

  const premiumDiscount =
    industryPeMean > 0 ? ((currentPe - industryPeMean) / industryPeMean) * 100 : 0;

  return {
    currentPe,
    currentPb,
    currentPs,
    industryPeMean,
    industryPeMedian,
    industryPbMean,
    industryPsMean,
    peValue,
    pbValue,
    psValue,
    relativeValue,
    premiumDiscount,
    peers: peerMultiples,
  };
}

export function calcHistoricalPercentiles(
  current: { pe: number; pb: number; ps: number },
  history: HistoricalValuationRow[],
) {
  return {
    pePercentile: calcPercentile(current.pe, history.map((h) => h.pe)),
    pbPercentile: calcPercentile(current.pb, history.map((h) => h.pb)),
    psPercentile: calcPercentile(current.ps, history.map((h) => h.ps)),
  };
}

export const DIFF_THRESHOLD = 20;

export function crossValidate(
  absoluteValue: number,
  relativeValue: number,
): { diffRate: number; conclusion: "一致" | "偏离" } {
  const diffRate =
    relativeValue > 0
      ? (Math.abs(absoluteValue - relativeValue) / relativeValue) * 100
      : 0;
  const conclusion: "一致" | "偏离" = diffRate < DIFF_THRESHOLD ? "一致" : "偏离";
  return { diffRate, conclusion };
}

export function calcSensitivityHeatmap(
  a: DcfAssumptions,
  b: CompanyBasics,
): SensitivityHeatmapCell[] {
  const waccRange = [0.07, 0.08, 0.09, 0.1, 0.11];
  const gRange = [-0.01, 0, 0.01, 0.02, 0.03];

  const cells: SensitivityHeatmapCell[] = [];
  for (const wacc of waccRange) {
    for (const g of gRange) {
      if (g >= wacc) continue;
      const sampled: DcfAssumptions = {
        ...a,
        ke: wacc,
        perpetualG: g,
      };
      const forward = calcForwardDcf(sampled, b);
      cells.push({
        wacc,
        g,
        targetPrice: num(forward.adjustedTargetPrice),
      });
    }
  }
  return cells;
}

export interface AiAttributionContext {
  name: string;
  absoluteValue: number;
  relativeValue: number;
  diffRate: number;
  g1: number;
  g2: number;
  g3: number;
  perpetualG: number;
  ke: number;
  currentPe: number;
  industryPeMean: number;
  pePercentile: number;
  premiumDiscount: number;
}

export function buildAiAttributionPrompt(ctx: AiAttributionContext): string {
  return `你是一位资深 A 股分析师，请对以下估值差异进行归因分析。

【标的】${ctx.name}
【绝对估值（DCF）】${ctx.absoluteValue.toFixed(1)} 亿元
【相对估值（PE/PB/PS 中位数法）】${ctx.relativeValue.toFixed(1)} 亿元
【差异率】${ctx.diffRate.toFixed(1)}%

【DCF 假设】
- 前 5 年增速 g1 = ${(ctx.g1 * 100).toFixed(1)}%
- 6-10 年增速 g2 = ${(ctx.g2 * 100).toFixed(1)}%
- 11-20 年增速 g3 = ${(ctx.g3 * 100).toFixed(1)}%
- 永续增长率 g = ${(ctx.perpetualG * 100).toFixed(1)}%
- 折现率 Ke = ${(ctx.ke * 100).toFixed(1)}%

【相对估值参考】
- 当前 PE = ${ctx.currentPe.toFixed(1)}
- 行业 PE 均值 = ${ctx.industryPeMean.toFixed(1)}
- PE 历史分位 = ${ctx.pePercentile.toFixed(0)}%
- 相对行业溢价率 = ${ctx.premiumDiscount.toFixed(1)}%

请从以下四个角度分析差异原因（300 字左右）：
1. 商业模式：公司盈利模式是否支撑 DCF 的高增速假设？
2. 行业周期：当前处于行业周期什么位置，影响 PE 中枢？
3. 盈利质量：CFO/E0、ROE 等指标是否支持 DCF 估值？
4. 增长预期：市场对公司未来增长的定价是否与 DCF 一致？

最后明确判断：是 DCF 高估了，还是相对估值低估了？给出结论。`;
}
