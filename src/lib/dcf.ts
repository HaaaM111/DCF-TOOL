
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

const RETENTION_RETURN = 0.02;
const GORDON_TOLERANCE = 0.1;

const num = (v: number): number => (Number.isFinite(v) ? v : 0);

export function calcForwardDcf(
  a: DcfAssumptions,
  b: CompanyBasics,
): ForwardDcfResult {
  const ke = num(a.ke);
  const gPerp = num(a.perpetualG);

  const rows: YearDcfRow[] = [];
  let fcfPrev = num(a.baseFcf);
  let retainedAccum = 0;

  for (let t = 1; t <= 20; t++) {
    let g: number;
    if (t <= 5) g = num(a.g1);
    else if (t <= 10) g = num(a.g2);
    else g = num(a.g3);

    const fcf = fcfPrev * (1 + g);
    const payoutRate = t <= 10 ? num(a.payoutRate1) : num(a.payoutRate2);
    const dividend = fcf * payoutRate;
    const retained = fcf - dividend;

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

  const dY20 = rows[19].dividend;
  const keMinusG = ke - gPerp;
  const terminalValue =
    keMinusG > 1e-6 ? (dY20 * (1 + gPerp)) / keMinusG : dY20 * 50;
  const pvTerminal = terminalValue / Math.pow(1 + ke, 20);

  const pvRetained = retainedAccum / Math.pow(1 + ke, 20);

  const netCash = num(b.netCash);

  const tvFcf = keMinusG > 1e-6 ? (fcfY20 * (1 + gPerp)) / keMinusG : fcfY20 * 50;
  const pvTvFcf = tvFcf / Math.pow(1 + ke, 20);
  const originalEv = pvExplicitFcf + pvTvFcf;
  const originalEquityValue = originalEv + netCash;
  const originalTargetPrice = originalEquityValue / num(b.shares);
  const originalUpside =
    (originalTargetPrice / num(b.currentPrice) - 1) * 100;

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

export function calcReverseDcf(
  a: DcfAssumptions,
  b: CompanyBasics,
  forward: ForwardDcfResult,
): ReverseDcfResult {
  const marketCap = num(b.currentPrice) * num(b.shares);
  const netCash = num(b.netCash);
  const ke = num(a.reverseR) || num(a.ke);
  const gPerp = num(a.perpetualG);

  let pvExplicit = 0;
  for (const r of forward.rows) {
    pvExplicit += r.fcf / Math.pow(1 + ke, r.year);
  }

  const impliedTvPv = marketCap - netCash - pvExplicit;
  const impliedTv = impliedTvPv * Math.pow(1 + ke, 20);

  const keMinusG = ke - gPerp;
  let l = 0;
  if (keMinusG > 1e-6) {
    l = (impliedTv * keMinusG) / (1 + gPerp);
  }

  const e3 = num(a.e3) || 1e-9;
  const e0 = num(b.e0) || 1e-9;
  const lE3 = l / e3;
  const lE0 = l / e0;

  const years = 17;
  let impliedCagr = 0;
  if (l > 0 && e3 > 0) {
    impliedCagr = (Math.pow(l / e3, 1 / years) - 1) * 100;
  }

  const dY20 = forward.rows[19].dividend;
  let impliedKe = ke;
  if (impliedTv > 1e-6 && dY20 > 0) {
    impliedKe = (dY20 * (1 + gPerp)) / impliedTv + gPerp;
  }
  impliedKe = Math.max(0, Math.min(1, impliedKe));

  return {
    l: num(l),
    lE3: num(lE3),
    lE0: num(lE0),
    impliedCagr: num(impliedCagr),
    impliedKe: num(impliedKe),
  };
}

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

export function calcSensitivity(
  a: DcfAssumptions,
  b: CompanyBasics,
  forward: ForwardDcfResult,
): SensitivityMatrix {
  const e3 = num(a.e3) || 1e-9;
  const marketCap = num(b.currentPrice) * num(b.shares);
  const netCash = num(b.netCash);

  const pvExplicitAt = (r: number) =>
    forward.rows.reduce((s, row) => s + row.fcf / Math.pow(1 + r, row.year), 0);

  const impliedTvAt = (r: number) => {
    const tvPv = marketCap - netCash - pvExplicitAt(r);
    return tvPv * Math.pow(1 + r, 20);
  };

  const rValues = [0.08, 0.09, 0.1, 0.11, 0.12];
  const rCells = rValues.map((r) => {
    const tv = impliedTvAt(r);
    const g = num(a.perpetualG);
    const l = r - g > 1e-6 ? (tv * (r - g)) / (1 + g) : 0;
    return { param: r, l: num(l), lE3: num(l / e3) };
  });

  const peValues = [5, 6, 7, 8, 9];
  const peCells = peValues.map((pe) => {
    const tv = impliedTvAt(num(a.reverseR) || num(a.ke));
    const l = pe > 0 ? tv / pe : 0;
    return { param: pe, l: num(l), lE3: num(l / e3) };
  });

  const gValues = [-0.01, 0, 0.01, 0.02, 0.03];
  const gCells = gValues.map((g) => {
    const r = num(a.reverseR) || num(a.ke);
    const tv = impliedTvAt(r);
    const l = r - g > 1e-6 ? (tv * (r - g)) / (1 + g) : 0;
    return { param: g, l: num(l), lE3: num(l / e3) };
  });

  return { r: rCells, exitPe: peCells, g: gCells };
}

export function calcDcf(a: DcfAssumptions, b: CompanyBasics): DcfOutput {
  const forward = calcForwardDcf(a, b);
  const reverse = calcReverseDcf(a, b, forward);
  const gordon = calcGordonCheck(a, reverse);
  const sensitivity = calcSensitivity(a, b, forward);
  return { forward, reverse, gordon, sensitivity };
}

export function classifyQuadrant(
  reverse: ReverseDcfResult,
  a: DcfAssumptions,
): string {
  const { lE3, impliedCagr } = reverse;
  const transitionG = num(a.transitionG) * 100;
  const PE_THRESHOLD = 30;
  const CAGR_GAP = 5;

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
