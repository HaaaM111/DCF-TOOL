import { z } from "zod";
import { calculateOperatingValuation, operatingValuationSchema, type OperatingValuationInput } from "./operating-valuation";
import { median } from "./relative-multiples";
import { seededRandom, standardNormal, summarizePrices } from "./simulation-statistics";

const axis = z.array(z.number().min(-0.99).max(1)).min(1).max(15);
const exposure = z.number().min(0).max(1e12);
const scenarioSchema = z.strictObject({
  sensitivity: z.strictObject({ wacc: axis, g: axis }).optional(),
  simulation: z.strictObject({
    samples: z.number().int().min(100).max(10000).default(10000),
    seed: z.number().int().min(0).max(4294967295).default(42),
    waccStd: z.number().min(0).max(0.1).default(0.01),
    growthStd: z.number().min(0).max(0.1).default(0.006),
    minimumSpread: z.number().min(0.0001).max(0.5).default(0.01),
    project: z.strictObject({
      startYear: z.number().int(),
      minimum: exposure, mode: exposure, maximum: exposure, baseline: exposure,
      afterTaxMargin: z.number().min(-1).max(1),
      assetTurnover: z.number().min(0.01).max(100),
    }).optional(),
  }).optional(),
  operatingPeers: z.strictObject({
    source: z.string().trim().min(1).max(240),
    availableOn: z.iso.date(),
    quoteDate: z.iso.date(),
    adjustment: z.number().min(0).max(0.95).default(0),
    companies: z.array(z.strictObject({
      ticker: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,19}$/),
      name: z.string().trim().min(1).max(80),
      reason: z.string().trim().min(1).max(160),
      marketCap: exposure.positive(),
      netFinancialObligations: z.number().min(-1e12).max(1e12),
      minorityInterest: exposure.default(0),
      forwardOperatingIncome: z.number().min(-1e12).max(1e12),
      openingNoa: z.number().min(-1e12).max(1e12),
    })).min(1).max(20),
  }).optional(),
});

export const operatingAnalysisSchema = operatingValuationSchema.safeExtend({ scenarios: scenarioSchema.optional() })
  .superRefine((input, ctx) => {
    const project = input.scenarios?.simulation?.project;
    if (project && (project.minimum > project.mode || project.mode > project.maximum
      || !input.forecast.some((row) => row.year === project.startYear))) {
      ctx.addIssue({ code: "custom", path: ["scenarios", "simulation", "project"], message: "三角分布须满足最小值 ≤ 众数 ≤ 最大值，起始年须属于显性预测期" });
    }
    const comps = input.scenarios?.operatingPeers;
    if (comps && (comps.availableOn > input.informationCutoff || comps.quoteDate !== `${input.baseYear}-12-31`
      || comps.availableOn < comps.quoteDate || new Set(comps.companies.map((p) => p.ticker)).size !== comps.companies.length
      || comps.companies.some((p) => p.ticker === input.ticker))) {
      ctx.addIssue({ code: "custom", path: ["scenarios", "operatingPeers"], message: "同行资料须满足截止日，市值日期须与基期年末相同，且同行代码须唯一并排除标的自身" });
    }
  });

export type OperatingAnalysisInput = z.infer<typeof operatingAnalysisSchema>;
type Simulation = NonNullable<NonNullable<OperatingAnalysisInput["scenarios"]>["simulation"]>;
type Project = NonNullable<Simulation["project"]>;

function feasible(wacc: number, g: number) {
  return wacc >= 0.001 && wacc <= 1 && g >= -0.99 && wacc - g >= 0.0001 - 1e-12;
}

/** Excel holds the capital charge at base WACC and changes the discount factors. */
export function workbookScenarioPrice(input: OperatingValuationInput, wacc: number, g: number, projectYear?: number, incomeShock = 0) {
  let priorNoa = input.openingNoa;
  let lastReoi = 0;
  let value = input.openingNoa - input.netFinancialObligations - input.minorityInterest;
  input.forecast.forEach((row, index) => {
    const shock = projectYear !== undefined && row.year >= projectYear ? incomeShock : 0;
    lastReoi = row.afterTaxOperatingIncome + shock - input.wacc * priorNoa;
    value += lastReoi / (1 + wacc) ** (index + 1);
    priorNoa = row.closingNoa;
  });
  return (value + lastReoi * (1 + g) / (wacc - g) / (1 + wacc) ** input.forecast.length) / input.shares;
}

function triangular(project: Project, u: number, branchDraw?: number) {
  const { minimum, mode, maximum } = project;
  if (minimum === maximum) return minimum;
  const width = maximum - minimum;
  const lower = u < (mode - minimum) / width;
  // The workbook draws an independent RAND() for the selected branch.
  const magnitude = branchDraw ?? (lower ? u : 1 - u);
  return lower ? minimum + Math.sqrt(magnitude * width * (mode - minimum))
    : maximum - Math.sqrt(magnitude * width * (maximum - mode));
}

function simulate(input: OperatingAnalysisInput, config: Simulation) {
  const rates = seededRandom(config.seed);
  const revenue = seededRandom(config.seed ^ 0x9e3779b9);
  const workbook: number[] = [], coherent: number[] = [];
  let capped = 0;
  for (let i = 0; i < config.samples; i++) {
    const wacc = input.wacc + config.waccStd * standardNormal(rates);
    const sampledG = input.terminalGrowth + config.growthStd * standardNormal(rates);
    const g = Math.min(sampledG, wacc - config.minimumSpread);
    if (!feasible(wacc, g)) continue;
    if (g < sampledG) capped++;
    const project = config.project;
    const u = revenue();
    const branchDraw = revenue();
    const delta = project ? triangular(project, u) - project.baseline : 0;
    const excelDelta = project ? triangular(project, u, branchDraw) - project.baseline : 0;
    workbook.push(workbookScenarioPrice(input, wacc, g, project?.startYear, excelDelta * (project?.afterTaxMargin ?? 0)));
    const forecast = project ? input.forecast.map((row) => row.year < project.startYear ? row : ({
      ...row, afterTaxOperatingIncome: row.afterTaxOperatingIncome + delta * project.afterTaxMargin,
      closingNoa: row.closingNoa + delta / project.assetTurnover,
    })) : input.forecast;
    coherent.push(calculateOperatingValuation({ ...input, wacc, terminalGrowth: g, forecast }).prices.reoi);
  }
  return { workbook: summarizePrices(workbook), coherent: summarizePrices(coherent), capped,
    rejected: config.samples - workbook.length, config };
}

export function analyzeOperatingValuation(input: OperatingAnalysisInput) {
  const base = calculateOperatingValuation(input);
  const config = input.scenarios;
  const defaultAxis = (center: number, step: number) =>
    [-2, -1, 0, 1, 2].map((offset) => Number((center + offset * step).toFixed(8)));
  const rates = [...new Set(config?.sensitivity?.wacc ?? defaultAxis(input.wacc, 0.01))];
  const growth = [...new Set(config?.sensitivity?.g ?? defaultAxis(input.terminalGrowth, 0.005))];
  const heatmap = rates.flatMap((wacc) => growth.map((g) => {
    const valid = feasible(wacc, g);
    return { wacc, g, workbookPrice: valid ? workbookScenarioPrice(input, wacc, g) : null,
      coherentPrice: valid ? calculateOperatingValuation({ ...input, wacc, terminalGrowth: g }).prices.reoi : null };
  }));
  const peers = config?.operatingPeers;
  const peerValuation = peers ? {
    source: peers.source, availableOn: peers.availableOn, quoteDate: peers.quoteDate,
    adjustment: peers.adjustment, retrospective: peers.availableOn > base.valuationDate,
    peers: peers.companies.map((p) => ({ ticker: p.ticker, name: p.name, reason: p.reason })),
    methods: [
      { name: "EV/次年税后经营利润", denominator: "forwardOperatingIncome" as const, subject: input.forecast[0].afterTaxOperatingIncome },
      { name: "EV/基期 NOA", denominator: "openingNoa" as const, subject: input.openingNoa },
    ].map(({ name, denominator, subject }) => {
      const values = peers.companies.flatMap((p) => {
        const ev = p.marketCap + p.netFinancialObligations + p.minorityInterest;
        return ev > 0 && p[denominator] > 0 ? [ev / p[denominator]] : [];
      });
      const midpoint = median(values);
      const adjustedMedian = midpoint === null ? null : midpoint * (1 - peers.adjustment);
      const price = values.length >= 3 && subject > 0 && adjustedMedian !== null
        ? (adjustedMedian * subject - input.netFinancialObligations - input.minorityInterest) / input.shares : null;
      return { name, count: values.length, median: midpoint, adjustedMedian, price };
    }),
  } : null;
  const peerPrices = peerValuation?.methods.flatMap(({ price }) => price === null ? [] : [price]) ?? [];
  const crossValidationRange = peerPrices.length
    ? { low: Math.min(base.prices.reoi, ...peerPrices), high: Math.max(base.prices.reoi, ...peerPrices) } : null;
  return { ...base, heatmap, simulation: config?.simulation ? simulate(input, config.simulation) : null, peerValuation, crossValidationRange };
}

export type OperatingAnalysis = ReturnType<typeof analyzeOperatingValuation>;
