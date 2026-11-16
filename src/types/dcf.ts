
export interface DcfAssumptions {
  baseFcf: number;
  g1: number;
  g2: number;
  g3: number;
  perpetualG: number;
  ke: number;
  payoutRate1: number;
  payoutRate2: number;
  e1: number;
  e2: number;
  e3: number;
  reverseR: number;
  exitPe: number;
  transitionG: number;
  terminalProfitEst: number;
}

export interface CompanyBasics {
  currentPrice: number;
  shares: number;
  netCash: number;
  e0: number;
}

export interface YearDcfRow {
  year: number;
  fcf: number;
  payoutRate: number;
  dividend: number;
  retained: number;
  pvDividend: number;
  pvFcf: number;
}

export interface ValueComposition {
  terminal: number;
  explicit: number;
  retainedCash: number;
  netCash: number;
  total: number;
}

export interface ForwardDcfResult {
  rows: YearDcfRow[];
  fcfY20: number;
  terminalValue: number;
  pvTerminal: number;
  pvExplicitFcf: number;
  pvExplicitDividend: number;
  retainedAccumulated: number;
  pvRetained: number;
  originalEv: number;
  originalEquityValue: number;
  originalTargetPrice: number;
  originalUpside: number;
  composition: ValueComposition;
  adjustedEquityValue: number;
  adjustedTargetPrice: number;
  adjustedUpside: number;
  wacc: number;
}

export interface ReverseDcfResult {
  l: number;
  lE3: number;
  lE0: number;
  impliedCagr: number;
  impliedKe: number;
}

export interface GordonCheckResult {
  impliedKe: number;
  forwardKe: number;
  deviation: number;
  isConsistent: boolean;
  reason: string;
}

export interface SensitivityCell {
  param: number;
  l: number;
  lE3: number;
}

export interface SensitivityMatrix {
  r: SensitivityCell[];
  exitPe: SensitivityCell[];
  g: SensitivityCell[];
}

export interface DcfOutput {
  forward: ForwardDcfResult;
  reverse: ReverseDcfResult;
  gordon: GordonCheckResult;
  sensitivity: SensitivityMatrix;
}

export interface MonteCarloResult {
  samples: number;
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  mean: number;
  stdDev: number;
  pricePercentile: number;
  histogram: { bin: number; count: number }[];
}
