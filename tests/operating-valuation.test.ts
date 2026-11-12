import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOperatingValuation, operatingValuationSchema,
  type OperatingValuationInput,
} from "../src/lib/operating-valuation";

const source = { name: "Synthetic input", availableOn: "2025-12-31" };
const input: OperatingValuationInput = {
  ticker: "TEST.SH", baseYear: 2025, informationCutoff: "2025-12-31",
  currency: "CNY", scale: "millions", openingSource: source, forecastSource: source,
  openingNoa: 100, netFinancialObligations: -10, minorityInterest: 3, shares: 10,
  wacc: 0.1, terminalGrowth: 0.02,
  forecast: [
    { year: 2026, afterTaxOperatingIncome: 12, closingNoa: 115 },
    { year: 2027, afterTaxOperatingIncome: 18, closingNoa: 120 },
  ],
};

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);

test("annual FCFF, ReOI and AOIG reconcile with a shared terminal and equity bridge", () => {
  const r = calculateOperatingValuation(operatingValuationSchema.parse(input));
  assert.deepEqual(r.rows.map(({ fcff }) => fcff), [-3, 13]);
  near(r.rows[1].aoig!, 4.5);
  near(r.terminal.fcff, 16.23);
  const expectedOperating = -3 / 1.1 + 13 / 1.1 ** 2 + (16.23 / 0.08) / 1.1 ** 2;
  near(r.bridge.operatingValue, expectedOperating);
  for (const price of Object.values(r.prices)) near(price, (expectedOperating + 10 - 3) / 10);
  assert.equal(r.reconciliation.passed, true);
});

test("reverse growth recovers the assumed rate with the full explicit forecast", () => {
  const price = calculateOperatingValuation(input).prices.fcff;
  const result = calculateOperatingValuation({ ...input, quote: { price, date: "2025-12-31", source: "Test" } });
  assert.equal(result.marketComparable, true);
  near(result.impliedGrowth!, 0.02);
});

test("mismatched quote or post-anchor forecast blocks market-implied growth", () => {
  const forecastSource = { ...source, availableOn: "2026-01-01" };
  const quote = { price: 20, date: "2025-12-31", source: "Test" };
  const retrospective = calculateOperatingValuation({ ...input, informationCutoff: "2026-01-01", forecastSource, quote });
  assert.equal(retrospective.retrospective, true);
  assert.equal(retrospective.impliedGrowth, null);
  const differentDate = calculateOperatingValuation({
    ...input, informationCutoff: "2026-01-01", quote: { ...quote, date: "2026-01-01" },
  });
  assert.equal(differentDate.marketComparable, false);
  assert.equal(differentDate.impliedGrowth, null);
});

test("single explicit year supports zero and negative perpetual growth", () => {
  for (const terminalGrowth of [0, -0.03]) {
    const r = calculateOperatingValuation({ ...input, terminalGrowth, forecast: input.forecast.slice(0, 1) });
    assert.equal(r.rows[0].aoig, null);
    assert.equal(r.reconciliation.passed, true);
  }
});

test("invalid dates, units, spread, missing ownership inputs and skipped years are rejected", () => {
  const invalidInputs = [
    { ...input, informationCutoff: "2026-02-30" },
    { ...input, forecastSource: { ...source, availableOn: "2026-01-01" } },
    { ...input, scale: "thousands" },
    { ...input, terminalGrowth: input.wacc - 0.00005 },
    { ...input, minorityInterest: undefined },
    { ...input, shares: 0 },
    { ...input, forecast: [{ ...input.forecast[0], year: 2027 }] },
  ];
  for (const invalid of invalidInputs) assert.equal(operatingValuationSchema.safeParse(invalid).success, false);
});
