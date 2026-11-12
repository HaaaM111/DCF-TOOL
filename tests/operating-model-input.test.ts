import assert from "node:assert/strict";
import test from "node:test";
import { analyzeOperatingModel, operatingModelInputSchema } from "../src/lib/operating-model-input";
import { operatingAnalysisSchema } from "../src/lib/operating-scenarios";

const draft = {
  ticker: "SAMPLE.SH", baseYear: 2025, informationCutoff: "2026-04-30",
  currency: "CNY", scale: "millions",
  openingSource: { name: "2025 财务报表", availableOn: "2026-04-12" },
  forecastSource: { name: "经营预测示例", availableOn: "2026-04-30" },
  openingBalance: { periodEnd: "2025-12-31", operatingAssets: 1200, operatingLiabilities: 200,
    financialAssets: 80, financialLiabilities: 50, parentBookEquity: 1018, minorityBookEquity: 12 },
  minorityInterest: 15, shares: 100, wacc: 0.095, terminalGrowth: 0.028,
  forecastDrivers: [{
    year: 2026,
    assetTurnover: 1.2,
    otherAfterTaxOperatingIncome: -3,
    segments: [
      { name: "A", revenue: 800, afterTaxOperatingMargin: 0.1 },
      { name: "B", revenue: 400, afterTaxOperatingMargin: 0.05 },
    ],
  }],
};

test("normalizes opening balances and segment drivers into a reproducible valuation input", () => {
  const input = operatingModelInputSchema.parse(draft);
  assert.equal(input.openingNoa, 1000);
  assert.equal(input.netFinancialObligations, -30);
  assert.deepEqual(input.forecast, [{ year: 2026, afterTaxOperatingIncome: 97, closingNoa: 1000 }]);
  assert.deepEqual(operatingModelInputSchema.parse(input), input);
  const result = analyzeOperatingModel(input);
  assert.equal(result.rows[0].fcff, 97);
  assert.equal(result.inputAudit.opening!.parentBookEquityDifference, 0);
  assert.equal(result.inputAudit.forecast![0].segmentOperatingIncome, 100);
  assert.equal(result.bridge.minorityInterest, 15);
  assert.equal(result.reconciliation.passed, true);
});

test("rejects contradictory forecast totals, net debt, ownership bridge and report dates", () => {
  const invalid = [
    { ...draft, openingNoa: 1234 },
    { ...draft, netFinancialObligations: 30 },
    { ...draft, openingBalance: { ...draft.openingBalance, parentBookEquity: 1030 } },
    { ...draft, openingBalance: { ...draft.openingBalance, periodEnd: "2025-09-30" } },
    { ...draft, openingSource: { ...draft.openingSource, availableOn: "2025-12-30" } },
    { ...draft, forecast: [{ year: 2026, afterTaxOperatingIncome: 100, closingNoa: 1000 }] },
    { ...draft, forecastDrivers: [{ ...draft.forecastDrivers[0], year: 2027 }] },
    { ...draft, forecastDrivers: [{ ...draft.forecastDrivers[0], segments: [{ ...draft.forecastDrivers[0].segments[0], revenue: 0 }] }] },
    { ...draft, forecastDrivers: [{ ...draft.forecastDrivers[0], segments: Array(2).fill(draft.forecastDrivers[0].segments[0]) }] },
  ];
  for (const item of invalid) assert.equal(operatingModelInputSchema.safeParse(item).success, false);
});

test("accepts existing immutable snapshots without changing their serialized input", () => {
  const { forecastDrivers, openingBalance, ...legacy } = draft;
  assert.equal(openingBalance.parentBookEquity, 1018);
  const raw = { ...legacy, openingNoa: 1000, netFinancialObligations: -30,
    forecast: [{ year: forecastDrivers[0].year, afterTaxOperatingIncome: 97, closingNoa: 1000 }] };
  const original = operatingAnalysisSchema.parse(raw);
  const input = operatingModelInputSchema.parse(raw);
  assert.equal(JSON.stringify(input), JSON.stringify(original));
  assert.equal(analyzeOperatingModel(input).inputAudit.forecast, null);
});
