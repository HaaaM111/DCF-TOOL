import { z } from "zod";
import { analyzeOperatingValuation, operatingAnalysisSchema } from "./operating-scenarios";

const signedAmount = z.number().min(-1e12).max(1e12);
const asset = signedAmount.nonnegative();

const openingBalanceSchema = z.strictObject({
  periodEnd: z.iso.date(),
  operatingAssets: asset,
  operatingLiabilities: asset,
  financialAssets: asset,
  financialLiabilities: asset,
  parentBookEquity: signedAmount,
  minorityBookEquity: signedAmount,
});

const forecastDriversSchema = z.array(z.strictObject({
  year: z.number().int().min(1901).max(2130),
  segments: z.array(z.strictObject({
    name: z.string().trim().min(1).max(100),
    revenue: asset,
    afterTaxOperatingMargin: z.number().min(-5).max(5),
  })).min(1).max(20),
  assetTurnover: z.number().min(0.001).max(1000),
  otherAfterTaxOperatingIncome: signedAmount.default(0),
})).min(1).max(30);

type OpeningBalance = z.infer<typeof openingBalanceSchema>;
type ForecastDriver = z.infer<typeof forecastDriversSchema>[number];

function reformBalance(balance: OpeningBalance) {
  const openingNoa = balance.operatingAssets - balance.operatingLiabilities;
  const netFinancialObligations = balance.financialLiabilities - balance.financialAssets;
  const parentBookEquity = openingNoa - netFinancialObligations - balance.minorityBookEquity;
  return { openingNoa, netFinancialObligations, parentBookEquity,
    parentBookEquityDifference: parentBookEquity - balance.parentBookEquity };
}

function buildYear(driver: ForecastDriver) {
  const revenue = driver.segments.reduce((sum, segment) => sum + segment.revenue, 0);
  const segmentOperatingIncome = driver.segments.reduce((sum, segment) =>
    sum + segment.revenue * segment.afterTaxOperatingMargin, 0);
  return {
    year: driver.year,
    revenue,
    segmentOperatingIncome,
    otherAfterTaxOperatingIncome: driver.otherAfterTaxOperatingIncome,
    afterTaxOperatingIncome: segmentOperatingIncome + driver.otherAfterTaxOperatingIncome,
    assetTurnover: driver.assetTurnover,
    closingNoa: revenue / driver.assetTurnover,
  };
}

function buildForecast(drivers: ForecastDriver[]) {
  return drivers.map((driver) => {
    const { year, afterTaxOperatingIncome, closingNoa } = buildYear(driver);
    return { year, afterTaxOperatingIncome, closingNoa };
  });
}

const matches = (value: number, expected: number) =>
  Math.abs(value - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-9);

const checkedInput = operatingAnalysisSchema.safeExtend({
  openingBalance: openingBalanceSchema.optional(),
  forecastDrivers: forecastDriversSchema.optional(),
}).superRefine((input, ctx) => {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });
  if (input.openingBalance) {
    const balance = reformBalance(input.openingBalance);
    if (input.openingBalance.periodEnd !== `${input.baseYear}-12-31`) {
      issue(["openingBalance", "periodEnd"], "期初报表日期必须等于估值基期年末");
    }
    if (input.openingSource.availableOn < input.openingBalance.periodEnd) {
      issue(["openingSource", "availableOn"], "期初报表可得日不能早于报告期末");
    }
    if (!matches(balance.parentBookEquity, input.openingBalance.parentBookEquity)) {
      issue(["openingBalance", "parentBookEquity"], "净经营资产 − 净金融负债 − 少数股东权益账面值须与归母净资产勾稽");
    }
    if (!matches(input.openingNoa, balance.openingNoa)) {
      issue(["openingNoa"], "期初净经营资产与期初报表桥接不一致");
    }
    if (!matches(input.netFinancialObligations, balance.netFinancialObligations)) {
      issue(["netFinancialObligations"], "期初净金融负债与期初报表桥接不一致");
    }
  }
  if (input.forecastDrivers) {
    if (input.forecastDrivers.length !== input.forecast.length) {
      issue(["forecastDrivers"], "分部预测与经营预测的年度数须相同");
    }
    input.forecastDrivers.forEach((driver, index) => {
      const forecast = input.forecast[index];
      const rebuilt = buildYear(driver);
      if (new Set(driver.segments.map(({ name }) => name)).size !== driver.segments.length) {
        issue(["forecastDrivers", index, "segments"], "同一年度的分部名称须唯一");
      }
      if (rebuilt.revenue <= 0) {
        issue(["forecastDrivers", index, "segments"], "年度合计收入须为正");
      }
      if (forecast && (forecast.year !== rebuilt.year
        || !matches(forecast.afterTaxOperatingIncome, rebuilt.afterTaxOperatingIncome)
        || !matches(forecast.closingNoa, rebuilt.closingNoa))) {
        issue(["forecast", index], "经营预测须与对应年度的分部收入、税后利润率和资产周转率勾稽");
      }
    });
  }
}).transform((input) => {
  const opening = input.openingBalance ? reformBalance(input.openingBalance) : null;
  return {
    ...input,
    openingNoa: opening?.openingNoa ?? input.openingNoa,
    netFinancialObligations: opening?.netFinancialObligations ?? input.netFinancialObligations,
    forecast: input.forecastDrivers ? buildForecast(input.forecastDrivers) : input.forecast,
  };
});

export const operatingModelInputSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const data = { ...raw } as Record<string, unknown>;
  if (data.forecast === undefined && data.forecastDrivers !== undefined) {
    const drivers = forecastDriversSchema.safeParse(data.forecastDrivers);
    if (drivers.success) data.forecast = buildForecast(drivers.data);
  }
  if ((data.openingNoa === undefined || data.netFinancialObligations === undefined) && data.openingBalance !== undefined) {
    const opening = openingBalanceSchema.safeParse(data.openingBalance);
    if (opening.success) {
      const balance = reformBalance(opening.data);
      if (data.openingNoa === undefined) data.openingNoa = balance.openingNoa;
      if (data.netFinancialObligations === undefined) data.netFinancialObligations = balance.netFinancialObligations;
    }
  }
  return data;
}, checkedInput);

export type OperatingModelInput = z.infer<typeof operatingModelInputSchema>;

export function operatingInputAudit(input: OperatingModelInput) {
  return {
    opening: input.openingBalance ? reformBalance(input.openingBalance) : null,
    forecast: input.forecastDrivers?.map(buildYear) ?? null,
  };
}

export function analyzeOperatingModel(input: OperatingModelInput) {
  return { ...analyzeOperatingValuation(input), input, inputAudit: operatingInputAudit(input) };
}

export type OperatingModelAnalysis = ReturnType<typeof analyzeOperatingModel>;
