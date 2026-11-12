import { z } from "zod";

const amount = z.number().min(-1e12).max(1e12);
const source = z.strictObject({
  name: z.string().trim().min(1).max(240),
  availableOn: z.iso.date(),
});

export const operatingValuationSchema = z.strictObject({
  ticker: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,19}$/),
  baseYear: z.number().int().min(1900).max(2100),
  informationCutoff: z.iso.date(),
  currency: z.enum(["CNY", "HKD", "USD"]),
  scale: z.enum(["ones", "millions", "hundredMillions"]),
  openingSource: source,
  forecastSource: source,
  openingNoa: amount,
  netFinancialObligations: amount,
  minorityInterest: amount.nonnegative(),
  shares: z.number().min(1e-6).max(1e12),
  wacc: z.number().min(0.001).max(1),
  terminalGrowth: z.number().min(-0.99).max(1),
  forecast: z.array(z.strictObject({
    year: z.number().int(),
    afterTaxOperatingIncome: amount,
    closingNoa: amount,
  })).min(1).max(30),
  benchmarkPrice: amount.optional(),
  quote: z.strictObject({
    price: z.number().min(1e-6).max(1e12),
    date: z.iso.date(),
    source: z.string().trim().min(1).max(240),
  }).optional(),
}).superRefine((input, ctx) => {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });
  if (input.wacc - input.terminalGrowth < 0.0001) {
    issue(["terminalGrowth"], "WACC 必须至少高于永续增长率 1 个基点");
  }
  if (input.informationCutoff < `${input.baseYear}-12-31`) {
    issue(["informationCutoff"], "资料截止日须在基期年末当日或之后");
  }
  for (const key of ["openingSource", "forecastSource"] as const) {
    if (input[key].availableOn > input.informationCutoff) {
      issue([key, "availableOn"], "资料可得日晚于资料截止日");
    }
  }
  if (input.quote && input.quote.date > input.informationCutoff) {
    issue(["quote", "date"], "报价日晚于资料截止日");
  }
  input.forecast.forEach((row, index) => {
    if (row.year !== input.baseYear + index + 1) {
      issue(["forecast", index, "year"], "预测年度须从基期次年起连续排列");
    }
  });
});

export type OperatingValuationInput = z.infer<typeof operatingValuationSchema>;

export function calculateOperatingValuation(input: OperatingValuationInput) {
  const { wacc, terminalGrowth: g, openingNoa, netFinancialObligations, minorityInterest, shares } = input;
  const valuationDate = `${input.baseYear}-12-31`;
  const retrospective = [input.openingSource, input.forecastSource]
    .some((source) => source.availableOn > valuationDate);

  let priorNoa = openingNoa;
  let priorIncome = 0;
  let priorFcf = 0;
  let pvFcf = 0;
  let pvReoi = 0;
  let pvAoig = 0;
  const rows = input.forecast.map(({ year, afterTaxOperatingIncome: income, closingNoa }, index) => {
    const reinvestment = closingNoa - priorNoa;
    const fcff = income - reinvestment;
    const reoi = income - wacc * priorNoa;
    const aoig = index === 0 ? null : (income - priorIncome) - wacc * (priorIncome - priorFcf);
    const discount = (1 + wacc) ** -(index + 1);
    pvFcf += fcff * discount;
    pvReoi += reoi * discount;
    if (aoig !== null) pvAoig += aoig * discount * (1 + wacc);
    priorNoa = closingNoa;
    priorIncome = income;
    priorFcf = fcff;
    return { year, income, closingNoa, reinvestment, fcff, reoi, aoig };
  });

  const last = rows[rows.length - 1];
  const terminalDiscount = (1 + wacc) ** -rows.length;
  // Grow ReOI and NOA at the same steady-state rate after the explicit forecast.
  const nextReoi = last.reoi * (1 + g);
  const nextIncome = nextReoi + wacc * last.closingNoa;
  const nextFcff = nextIncome - g * last.closingNoa;
  const pvOperatingTerminal = nextFcff / (wacc - g) * terminalDiscount;
  const operatingValue = pvFcf + pvOperatingTerminal;
  const reoiValue = openingNoa + pvReoi + nextReoi / (wacc - g) * terminalDiscount;
  // AOIG is discounted one period earlier than the matching ReOI.
  const pvAoigTerminal = g * last.reoi / (wacc - g) * terminalDiscount * (1 + wacc);
  const aoigValue = (rows[0].income + pvAoig + pvAoigTerminal) / wacc;

  const perShare = (value: number) => (value - netFinancialObligations - minorityInterest) / shares;
  const prices = { fcff: perShare(operatingValue), reoi: perShare(reoiValue), aoig: perShare(aoigValue) };
  const operatingValues = [operatingValue, reoiValue, aoigValue];
  const maximumGap = (Math.max(...operatingValues) - Math.min(...operatingValues)) / shares;
  // Use a relative floor for roundoff with very large valuation components.
  const tolerance = Math.max(1e-8, Math.max(...operatingValues.map(Math.abs)) / shares * 1e-9);
  const equityValue = operatingValue - netFinancialObligations - minorityInterest;
  const marketComparable = !!input.quote && input.quote.date === valuationDate && !retrospective;
  let impliedGrowth: number | null = null;
  if (input.quote && marketComparable && last.reoi !== 0) {
    const marketOperatingValue = input.quote.price * shares + netFinancialObligations + minorityInterest;
    const requiredReoiTerminal = (marketOperatingValue - openingNoa - pvReoi) / terminalDiscount;
    const growth = (wacc * requiredReoiTerminal - last.reoi) / (requiredReoiTerminal + last.reoi);
    if (Number.isFinite(growth) && growth > -1 && growth < wacc) impliedGrowth = growth;
  }

  return {
    model: "annual-operating-valuation-v1",
    input,
    valuationDate,
    retrospective,
    rows,
    terminal: { year: last.year + 1, growth: g, afterTaxOperatingIncome: nextIncome, fcff: nextFcff, reoi: nextReoi,
      pvOperatingTerminal, operatingValueShare: operatingValue > 0 ? pvOperatingTerminal / operatingValue : null },
    bridge: { operatingValue, netFinancialObligations, minorityInterest, equityValue },
    prices,
    reconciliation: { maximumGap, tolerance, passed: maximumGap <= tolerance },
    benchmarkDifference: input.benchmarkPrice === undefined ? null : prices.reoi - input.benchmarkPrice,
    marketComparable,
    impliedGrowth,
  };
}

export type OperatingValuationResult = ReturnType<typeof calculateOperatingValuation>;
