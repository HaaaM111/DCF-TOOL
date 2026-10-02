/**
 * 估值验证与交叉验证计算引擎
 * ------------------------------------------------------------------
 * 1. 相对估值（PE/PB/PS）—— 行业均值 × 公司基本面
 * 2. 历史纵向分位 —— 当前 PE 在历史区间的位置
 * 3. 绝对 × 相对 交叉验证 —— 差异率判定 + AI 归因触发
 * 4. 2D 敏感性热力图 —— WACC × 永续 g 矩阵
 *
 * 所有函数为纯函数，便于单测与复用。
 */

import { calcForwardDcf } from "./dcf";
import type { CompanyBasics, DcfAssumptions } from "@/types/dcf";

const num = (v: number) => (Number.isFinite(v) ? v : 0);

// ============================================================
// 类型定义
// ============================================================

export interface PeerData {
  ticker: string;
  name: string;
  marketCap: number; // 亿元
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
  // 当前估值倍数
  currentPe: number;
  currentPb: number;
  currentPs: number;
  // 行业中枢
  industryPeMean: number;
  industryPeMedian: number;
  industryPbMean: number;
  industryPsMean: number;
  // 相对估值法推算的合理市值（亿元）
  peValue: number; // 行业 PE 均值 × E0
  pbValue: number; // 行业 PB 均值 × B0
  psValue: number; // 行业 PS 均值 × S0
  relativeValue: number; // 三者中位数
  // 溢价/折价率 %
  premiumDiscount: number;
  // 同行明细（供前端展示）
  peers: { ticker: string; name: string; pe: number; pb: number; ps: number }[];
}

export interface ValidationResult {
  absoluteValue: number; // DCF 股权价值（亿元）
  relative: RelativeValuationResult;
  relativeValue: number; // 相对估值（亿元）
  diffRate: number; // |绝对 - 相对| / 相对 × 100%
  conclusion: "一致" | "偏离";
  // 历史分位 (0~100)
  pePercentile: number;
  pbPercentile: number;
  psPercentile: number;
}

export interface SensitivityHeatmapCell {
  wacc: number;
  g: number;
  targetPrice: number;
}

// ============================================================
// 工具函数
// ============================================================

/** 安全除法：分母为 0 时返回 0 */
function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

/** 计算数组均值（过滤无效值） */
function mean(arr: number[]): number {
  const valid = arr.filter((v) => Number.isFinite(v) && v > 0);
  if (valid.length === 0) return 0;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

/** 计算数组中位数 */
function median(arr: number[]): number {
  const valid = arr.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0
    ? (valid[mid - 1] + valid[mid]) / 2
    : valid[mid];
}

/**
 * 计算分位数：当前值在历史序列中的百分位（0~100）
 * 经验分布法：小于等于当前值的样本占比
 */
export function calcPercentile(current: number, history: (number | null | undefined)[]): number {
  const valid = history.filter((v): v is number => Number.isFinite(v as number) && (v as number) > 0);
  if (valid.length === 0) return 50; // 无历史数据，默认中位
  const count = valid.filter((v) => v <= current).length;
  return (count / valid.length) * 100;
}

// ============================================================
// 1. 相对估值计算
// ============================================================

/**
 * 计算相对估值（PE/PB/PS）
 * @param marketCap 本公司当前市值（亿元）
 * @param e0 归母净利润（亿元）
 * @param revenue 营收（亿元）
 * @param bookValue 归母净资产（亿元）
 * @param peers 同行数据列表
 */
export function calcRelativeValuation(
  marketCap: number,
  e0: number,
  revenue: number,
  bookValue: number,
  peers: PeerData[],
): RelativeValuationResult {
  // 本公司当前倍数
  const currentPe = safeDiv(marketCap, e0);
  const currentPb = safeDiv(marketCap, bookValue);
  const currentPs = safeDiv(marketCap, revenue);

  // 同行倍数
  const peerMultiples = peers.map((p) => ({
    ticker: p.ticker,
    name: p.name,
    pe: safeDiv(p.marketCap, p.e0),
    pb: safeDiv(p.marketCap, p.bookValue),
    ps: safeDiv(p.marketCap, p.revenue),
  }));

  // 行业中枢
  const industryPeMean = mean(peerMultiples.map((p) => p.pe));
  const industryPeMedian = median(peerMultiples.map((p) => p.pe));
  const industryPbMean = mean(peerMultiples.map((p) => p.pb));
  const industryPsMean = mean(peerMultiples.map((p) => p.ps));

  // 相对估值法推算合理市值
  const peValue = industryPeMean * num(e0);
  const pbValue = industryPbMean * num(bookValue);
  const psValue = industryPsMean * num(revenue);

  // 取中位数抗异常
  const relativeValue = median([peValue, pbValue, psValue]);

  // 溢价/折价率（以 PE 为代表）
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

// ============================================================
// 2. 历史纵向分位
// ============================================================

/**
 * 计算当前 PE/PB/PS 在历史区间的分位
 */
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

// ============================================================
// 3. 交叉验证
// ============================================================

/** 差异率阈值（%），超过即为"偏离" */
export const DIFF_THRESHOLD = 20;

/**
 * 绝对 × 相对 交叉验证
 * @param absoluteValue DCF 绝对估值（亿元）
 * @param relativeValue 相对估值（亿元）
 */
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

// ============================================================
// 4. 2D 敏感性热力图（WACC × 永续 g）
// ============================================================

/**
 * 生成 WACC × 永续 g 的二维敏感性矩阵
 * 每个组合重跑 calcForwardDcf，记录调整后目标价
 */
export function calcSensitivityHeatmap(
  a: DcfAssumptions,
  b: CompanyBasics,
): SensitivityHeatmapCell[] {
  const waccRange = [0.07, 0.08, 0.09, 0.1, 0.11];
  const gRange = [-0.01, 0, 0.01, 0.02, 0.03];

  const cells: SensitivityHeatmapCell[] = [];
  for (const wacc of waccRange) {
    for (const g of gRange) {
      // 永续 g 必须 < wacc，否则 Gordon 爆炸
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

// ============================================================
// 5. AI 归因 Prompt 构建
// ============================================================

export interface AiAttributionContext {
  name: string;
  absoluteValue: number; // DCF 估值（亿元）
  relativeValue: number; // 相对估值（亿元）
  diffRate: number; // 差异率 %
  // DCF 假设
  g1: number;
  g2: number;
  g3: number;
  perpetualG: number;
  ke: number;
  // 相对估值
  currentPe: number;
  industryPeMean: number;
  pePercentile: number;
  premiumDiscount: number;
}

/**
 * 构建 AI 归因分析 Prompt
 * 差异率 >= 20% 时触发
 */
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
