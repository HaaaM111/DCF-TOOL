// DCF 模型核心类型定义
// 与 Prisma Schema 对应，并补充计算中间结果类型

/** 估值模型假设输入 */
export interface DcfAssumptions {
  baseFcf: number;        // 起始自由现金流（亿元）
  g1: number;             // 前 5 年复合增速
  g2: number;             // 6-10 年复合增速
  g3: number;             // 11-20 年复合增速
  perpetualG: number;     // 第 20 年永续增长率 g
  ke: number;             // 股权要求回报率 Ke
  payoutRate1: number;    // 前 10 年预测派现率
  payoutRate2: number;    // 10 年后预测派现率
  e1: number;             // E1 当年预期利润
  e2: number;             // E2 次年预期利润
  e3: number;             // E3 第三年预期利润
  reverseR: number;       // 逆向反算折现率 r
  exitPe: number;         // 终局退出乘数 Exit PE
  transitionG: number;    // 过渡期年化增速 g
  terminalProfitEst: number; // 我的终局利润估计
}

/** 公司基础数据 */
export interface CompanyBasics {
  currentPrice: number;   // 最新市价
  shares: number;         // 总股本（亿股）
  netCash: number;        // 净现金合计（亿元）
  e0: number;             // E0 归母净利润
}

/** 单年 DCF 推演结果 */
export interface YearDcfRow {
  year: number;           // 第 t 年（1..20）
  fcf: number;            // 自由现金流
  payoutRate: number;     // 派现率
  dividend: number;       // 分红
  retained: number;       // 留存现金
  pvDividend: number;     // 分红现值
  pvFcf: number;          // FCF 现值
}

/** 价值构成（环形图数据） */
export interface ValueComposition {
  terminal: number;       // 终值（20年后永续派现）
  explicit: number;       // 显性期（前20年派现折现）
  retainedCash: number;   // 留存现金累积（按复利）
  netCash: number;        // 净现金 (+) / 净负债 (-)
  total: number;          // 股权价值合计
}

/** 正向 DCF 完整计算结果 */
export interface ForwardDcfResult {
  rows: YearDcfRow[];             // 20 年推演明细
  fcfY20: number;                 // 第 20 年 FCF
  terminalValue: number;          // 第 20 年末永续价值
  pvTerminal: number;             // 永续价值现值
  pvExplicitFcf: number;          // 显性期 FCF 现值合计
  pvExplicitDividend: number;     // 显性期分红现值合计
  retainedAccumulated: number;    // 第 20 年留存现金累积
  pvRetained: number;             // 留存现金累积现值
  // 原版口径（FCF DCF）
  originalEv: number;             // DCF 实体价值
  originalEquityValue: number;    // 股权价值（+净现金）
  originalTargetPrice: number;    // 原版目标价
  originalUpside: number;         // 原版上涨空间 %
  // 股东回报口径（分红修正）
  composition: ValueComposition;
  adjustedEquityValue: number;    // 调整后股权价值
  adjustedTargetPrice: number;    // 调整后目标价
  adjustedUpside: number;         // 调整后上涨空间 %
  // WACC
  wacc: number;
}

/** 逆向 DCF 结果 */
export interface ReverseDcfResult {
  l: number;              // 市场隐含终局利润 L
  lE3: number;            // L / E3 倍数
  lE0: number;            // L / E0 倍数
  impliedCagr: number;    // 隐含终局 CAGR（20y）%
  impliedKe: number;      // 隐含 Ke（Gordon 反推）
}

/** Gordon 自洽校验结果 */
export interface GordonCheckResult {
  impliedKe: number;      // 隐含 Ke
  forwardKe: number;      // 正向 Ke
  deviation: number;      // 偏差 %
  isConsistent: boolean;  // 是否自洽（偏差 < 10%）
  reason: string;         // 原因分析
}

/** 敏感性矩阵单元 */
export interface SensitivityCell {
  param: number;          // 参数值
  l: number;              // 隐含终局利润 L
  lE3: number;            // L/E3
}

/** 敏感性矩阵 */
export interface SensitivityMatrix {
  r: SensitivityCell[];       // L 对折现率 r
  exitPe: SensitivityCell[];  // L 对退出 PE
  g: SensitivityCell[];       // L 对永续 g
}

/** 完整 DCF 计算输出 */
export interface DcfOutput {
  forward: ForwardDcfResult;
  reverse: ReverseDcfResult;
  gordon: GordonCheckResult;
  sensitivity: SensitivityMatrix;
}

/** 蒙特卡洛模拟结果 */
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
