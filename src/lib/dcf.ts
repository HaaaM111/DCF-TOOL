/**
 * DCF 预期差挖掘工具 — 核心计算引擎
 * ------------------------------------------------------------------
 * 包含四大模块：
 *   1. 正向 DCF（20 年 FCF 推演 + Gordon 永续 + 股东回报口径）
 *   2. 逆向 DCF（反算市场隐含终局利润 L）
 *   3. Gordon 镜像自洽校验
 *   4. 三变量敏感性矩阵（L 对 r / ExitPE / g）
 *
 * 安全约定：
 *   - 所有入参在调用前必须经过 Zod 校验（见 lib/validation.ts）
 *   - 计算过程对除零、负永续增长差等做防御性处理
 *   - 本模块为纯函数，无副作用，可在前后端复用，后端结果为权威值
 */

import type {
  CompanyBasics,
  DcfAssumptions,
  DcfOutput,
  ForwardDcfResult,
  GordonCheckResult,
  ReverseDcfResult,
  SensitivityMatrix,
  ValueComposition,
  YearDcfRow,
} from "@/types/dcf";

/** 留存现金复利收益率（股东回报口径下留存现金的再投资回报率） */
const RETENTION_RETURN = 0.02;
/** Gordon 自洽偏差容忍阈值（%），超过则判定“不自治” */
const GORDON_TOLERANCE = 0.1;

/** 数值防御：确保为有限数，非有限数回退为 0 */
const num = (v: number): number => (Number.isFinite(v) ? v : 0);

/**
 * 1. 正向 DCF：20 年自由现金流推演
 * 返回显性期现值、终值、留存现金累积，以及原版/调整后两套估值。
 */
export function calcForwardDcf(
  a: DcfAssumptions,
  b: CompanyBasics,
): ForwardDcfResult {
  const ke = num(a.ke);
  const gPerp = num(a.perpetualG);

  // ---- 20 年 FCF 推演 ----
  const rows: YearDcfRow[] = [];
  let fcfPrev = num(a.baseFcf);
  let retainedAccum = 0; // 留存现金累积（按 RETENTION_RETURN 复利）

  for (let t = 1; t <= 20; t++) {
    let g: number;
    if (t <= 5) g = num(a.g1);
    else if (t <= 10) g = num(a.g2);
    else g = num(a.g3);

    const fcf = fcfPrev * (1 + g);
    const payoutRate = t <= 10 ? num(a.payoutRate1) : num(a.payoutRate2);
    const dividend = fcf * payoutRate;
    const retained = fcf - dividend;

    // 留存现金累积：上一年累积 * (1+retentionReturn) + 当年留存
    retainedAccum = retainedAccum * (1 + RETENTION_RETURN) + retained;

    const discount = Math.pow(1 + ke, t);
    const pvFcf = fcf / discount;
    const pvDividend = dividend / discount;

    rows.push({ year: t, fcf, payoutRate, dividend, retained, pvDividend, pvFcf });
    fcfPrev = fcf;
  }

  const fcfY20 = rows[19].fcf;
  const pvExplicitFcf = rows.reduce((s, r) => s + r.pvFcf, 0);
  const pvExplicitDividend = rows.reduce((s, r) => s + r.pvDividend, 0);

  // ---- 永续价值（Gordon）----
  // 用第 20 年分红作为永续起点，更贴合“股东回报口径”
  const dY20 = rows[19].dividend;
  const keMinusG = ke - gPerp;
  // 永续价值（年末）；若 ke<=g 退化为有限倍数避免爆炸
  const terminalValue =
    keMinusG > 1e-6 ? (dY20 * (1 + gPerp)) / keMinusG : dY20 * 50;
  const pvTerminal = terminalValue / Math.pow(1 + ke, 20);

  // 留存现金累积折现到现值
  const pvRetained = retainedAccum / Math.pow(1 + ke, 20);

  const netCash = num(b.netCash);

  // ---- 原版口径（FCF DCF）----
  // TV 用 FCF 而非分红
  const tvFcf = keMinusG > 1e-6 ? (fcfY20 * (1 + gPerp)) / keMinusG : fcfY20 * 50;
  const pvTvFcf = tvFcf / Math.pow(1 + ke, 20);
  const originalEv = pvExplicitFcf + pvTvFcf;
  const originalEquityValue = originalEv + netCash;
  const originalTargetPrice = originalEquityValue / num(b.shares);
  const originalUpside =
    (originalTargetPrice / num(b.currentPrice) - 1) * 100;

  // ---- 股东回报口径（分红修正）----
  const composition: ValueComposition = {
    terminal: num(pvTerminal),
    explicit: num(pvExplicitDividend),
    retainedCash: num(pvRetained),
    netCash,
    total: 0,
  };
  composition.total =
    composition.terminal +
    composition.explicit +
    composition.retainedCash +
    composition.netCash;

  const adjustedEquityValue = composition.total;
  const adjustedTargetPrice = adjustedEquityValue / num(b.shares);
  const adjustedUpside =
    (adjustedTargetPrice / num(b.currentPrice) - 1) * 100;

  // WACC：本系统简化为股权 DCF，WACC ≈ Ke（无债务权重影响）
  // 若需精确 WACC，可扩展：WACC = Ke*E/(D+E) + Kd*(1-T)*D/(D+E)
  const wacc = ke;

  return {
    rows,
    fcfY20: num(fcfY20),
    terminalValue: num(terminalValue),
    pvTerminal: num(pvTerminal),
    pvExplicitFcf: num(pvExplicitFcf),
    pvExplicitDividend: num(pvExplicitDividend),
    retainedAccumulated: num(retainedAccum),
    pvRetained: num(pvRetained),
    originalEv: num(originalEv),
    originalEquityValue: num(originalEquityValue),
    originalTargetPrice: num(originalTargetPrice),
    originalUpside: num(originalUpside),
    composition,
    adjustedEquityValue: num(adjustedEquityValue),
    adjustedTargetPrice: num(adjustedTargetPrice),
    adjustedUpside: num(adjustedUpside),
    wacc,
  };
}

/**
 * 2. 逆向 DCF：反算市场隐含终局利润 L
 * 思路：当前市值 = 显性期现值 + 终值现值 + 净现金
 *   反解出第 20 年的终值 TV，再由 TV 反推终局利润 L。
 *
 * 三种终值定价方式对应三种 L：
 *   - L_conservative：用 reverseR 作折现率、Gordon 永续
 *   - L_multiple：用 Exit PE 倍数
 *   - L_gordon：用 Gordon 模型（给定永续 g）
 */
export function calcReverseDcf(
  a: DcfAssumptions,
  b: CompanyBasics,
  forward: ForwardDcfResult,
): ReverseDcfResult {
  const marketCap = num(b.currentPrice) * num(b.shares);
  const netCash = num(b.netCash);
  const ke = num(a.reverseR) || num(a.ke);
  const gPerp = num(a.perpetualG);

  // 显性期现值（用逆向折现率重算 FCF 现值）
  let pvExplicit = 0;
  for (const r of forward.rows) {
    pvExplicit += r.fcf / Math.pow(1 + ke, r.year);
  }

  // 隐含终值现值 = 市值 - 净现金 - 显性期现值
  const impliedTvPv = marketCap - netCash - pvExplicit;
  // 隐含终值（第 20 年末）
  const impliedTv = impliedTvPv * Math.pow(1 + ke, 20);

  // 由终值反推终局利润 L（Gordon：TV = L*(1+g)/(ke-g)）
  const keMinusG = ke - gPerp;
  let l = 0;
  if (keMinusG > 1e-6) {
    l = (impliedTv * keMinusG) / (1 + gPerp);
  }

  const e3 = num(a.e3) || 1e-9;
  const e0 = num(b.e0) || 1e-9;
  const lE3 = l / e3;
  const lE0 = l / e0;

  // 隐含终局 CAGR（从 E3 到 L，历经 17 年：E3 是第 3 年，终局是第 20 年）
  const years = 17;
  let impliedCagr = 0;
  if (l > 0 && e3 > 0) {
    impliedCagr = (Math.pow(l / e3, 1 / years) - 1) * 100;
  }

  // 隐含 Ke（Gordon 反推）：由隐含终值反推折现率
  // Gordon: TV = D_20 * (1+g) / (Ke - g)  =>  Ke = D_20*(1+g)/TV + g
  const dY20 = forward.rows[19].dividend;
  let impliedKe = ke; // 默认取正向 Ke（现金覆盖型时隐含 Ke 无意义）
  if (impliedTv > 1e-6 && dY20 > 0) {
    impliedKe = (dY20 * (1 + gPerp)) / impliedTv + gPerp;
  }
  // 防御：隐含 Ke 限制在合理区间 [0, 1]，防止除零/负值爆炸
  impliedKe = Math.max(0, Math.min(1, impliedKe));

  return {
    l: num(l),
    lE3: num(lE3),
    lE0: num(lE0),
    impliedCagr: num(impliedCagr),
    impliedKe: num(impliedKe),
  };
}

/**
 * 3. Gordon 镜像自洽校验
 * 对比隐含 Ke 与正向 Ke 的偏差，给出是否自洽的判断。
 */
export function calcGordonCheck(
  a: DcfAssumptions,
  reverse: ReverseDcfResult,
): GordonCheckResult {
  const forwardKe = num(a.ke);
  const impliedKe = num(reverse.impliedKe);
  const deviation =
    forwardKe > 1e-9 ? ((impliedKe - forwardKe) / forwardKe) * 100 : 0;
  const isConsistent = Math.abs(deviation) <= GORDON_TOLERANCE * 100;

  let reason: string;
  if (isConsistent) {
    reason = `隐含 Ke（${(impliedKe * 100).toFixed(1)}%）与正向 Ke（${(forwardKe * 100).toFixed(1)}%）偏差 ${deviation.toFixed(1)}%，在 ±${GORDON_TOLERANCE * 100}% 容忍区间内，模型自洽。`;
  } else if (impliedKe < forwardKe) {
    reason = `隐含 Ke（${(impliedKe * 100).toFixed(1)}%）显著低于正向 Ke（${(forwardKe * 100).toFixed(1)}%），偏差 ${deviation.toFixed(1)}%。说明市场用更低的折现率定价，或当前股价隐含了更乐观的预期；若你的本意是按正向 Ke 保守定价，可在备注中说明该分歧。`;
  } else {
    reason = `隐含 Ke（${(impliedKe * 100).toFixed(1)}%）显著高于正向 Ke（${(forwardKe * 100).toFixed(1)}%），偏差 ${deviation.toFixed(1)}%。说明市场要求更高回报，可能定价偏保守或存在风险折价；需校验 Ke 或 Exit PE 假设。`;
  }

  return {
    impliedKe,
    forwardKe,
    deviation: num(deviation),
    isConsistent,
    reason,
  };
}

/**
 * 4. 三变量敏感性矩阵：L 对 折现率r / 退出PE / 永续g
 * 每个变量独立扫点，其余参数取模型设定值。
 */
export function calcSensitivity(
  a: DcfAssumptions,
  b: CompanyBasics,
  forward: ForwardDcfResult,
): SensitivityMatrix {
  const e3 = num(a.e3) || 1e-9;
  const marketCap = num(b.currentPrice) * num(b.shares);
  const netCash = num(b.netCash);

  // 用指定折现率重算显性期现值
  const pvExplicitAt = (r: number) =>
    forward.rows.reduce((s, row) => s + row.fcf / Math.pow(1 + r, row.year), 0);

  const impliedTvAt = (r: number) => {
    const tvPv = marketCap - netCash - pvExplicitAt(r);
    return tvPv * Math.pow(1 + r, 20);
  };

  // ① L 对折现率 r（Gordon 永续）
  const rValues = [0.08, 0.09, 0.1, 0.11, 0.12];
  const rCells = rValues.map((r) => {
    const tv = impliedTvAt(r);
    const g = num(a.perpetualG);
    const l = r - g > 1e-6 ? (tv * (r - g)) / (1 + g) : 0;
    return { param: r, l: num(l), lE3: num(l / e3) };
  });

  // ② L 对退出 PE（终值 = L * ExitPE）
  const peValues = [5, 6, 7, 8, 9];
  const peCells = peValues.map((pe) => {
    const tv = impliedTvAt(num(a.reverseR) || num(a.ke));
    const l = pe > 0 ? tv / pe : 0;
    return { param: pe, l: num(l), lE3: num(l / e3) };
  });

  // ③ L 对永续 g（Gordon）
  const gValues = [-0.01, 0, 0.01, 0.02, 0.03];
  const gCells = gValues.map((g) => {
    const r = num(a.reverseR) || num(a.ke);
    const tv = impliedTvAt(r);
    const l = r - g > 1e-6 ? (tv * (r - g)) / (1 + g) : 0;
    return { param: g, l: num(l), lE3: num(l / e3) };
  });

  return { r: rCells, exitPe: peCells, g: gCells };
}

/**
 * 一站式计算：正向 + 逆向 + Gordon + 敏感性
 */
export function calcDcf(a: DcfAssumptions, b: CompanyBasics): DcfOutput {
  const forward = calcForwardDcf(a, b);
  const reverse = calcReverseDcf(a, b, forward);
  const gordon = calcGordonCheck(a, reverse);
  const sensitivity = calcSensitivity(a, b, forward);
  return { forward, reverse, gordon, sensitivity };
}

/**
 * 四象限诊断分类（用于首页四象限标签）
 * 规则：
 *   - 绿灯双低：L/E3 倍数低 且 隐含 CAGR 低（市场预期保守，有容错空间）
 *   - 绿灯预期已装满：L/E3 合理 且 隐含 CAGR 接近假设（预期已较充分）
 *   - 红灯退出倍数高：L/E3 倍数显著偏高（市场给了高退出倍数）
 *   - 红灯预期落空：隐含 CAGR 远低于假设过渡增速（预期可能落空）
 */
export function classifyQuadrant(
  reverse: ReverseDcfResult,
  a: DcfAssumptions,
): string {
  const { lE3, impliedCagr } = reverse;
  const transitionG = num(a.transitionG) * 100;
  const PE_THRESHOLD = 30; // L/E3 倍数阈值
  const CAGR_GAP = 5; // CAGR 差距阈值（百分点）

  if (lE3 < PE_THRESHOLD && impliedCagr < transitionG - CAGR_GAP) {
    return "绿灯双低·容错增厚";
  }
  if (lE3 < PE_THRESHOLD && Math.abs(impliedCagr - transitionG) <= CAGR_GAP) {
    return "绿灯·预期已装满";
  }
  if (lE3 >= PE_THRESHOLD) {
    return "红灯·退出倍数高";
  }
  return "红灯·预期落空";
}

/**
 * 叙事分级诊断（用于排行榜“叙事分级诊断”列）
 */
export function diagnoseNarrative(
  reverse: ReverseDcfResult,
  gordon: GordonCheckResult,
  b: CompanyBasics,
): string {
  const marketCap = num(b.currentPrice) * num(b.shares);
  const netCash = num(b.netCash);
  if (marketCap > 0 && netCash > marketCap) {
    return "现金覆盖型";
  }
  if (reverse.lE3 < 0) {
    return "现金覆盖/业务负定价";
  }
  if (reverse.lE3 > 40) {
    return "高增长透支";
  }
  if (!gordon.isConsistent) {
    return "需重审 Ke";
  }
  return "稳态估值";
}
