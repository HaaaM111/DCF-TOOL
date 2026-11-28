import assert from "node:assert/strict";
import test from "node:test";
import { cashFlowFromReport, latestAnnualPeriod, threeYearCashFlowMedian } from "../src/lib/annual-cash-flow";

const reports = [
  { periodEnd: "2025-12-31", cfo: 10, capex: 2 },
  { periodEnd: "2024-12-31", cfo: 50, capex: 0 },
  { periodEnd: "2023-12-31", cfo: -3, capex: 1 },
];

test("annual free cash flow preserves true zeros and negative operating cash flow", () => {
  assert.equal(threeYearCashFlowMedian(reports, "2025-12-31"), 8);
  assert.equal(cashFlowFromReport(reports[1]), 50);
  assert.equal(cashFlowFromReport(reports[2]), -4);
  assert.equal(latestAnnualPeriod(new Date(2026, 10, 15)), "2025-12-31");
});

test("median is withheld for incomplete, duplicate or nonconsecutive report periods", () => {
  assert.equal(threeYearCashFlowMedian(reports.slice(0, 2), "2025-12-31"), null);
  assert.equal(threeYearCashFlowMedian([...reports, reports[0]], "2025-12-31"), null);
  assert.equal(threeYearCashFlowMedian([{ ...reports[0], capex: null }, ...reports.slice(1)], "2025-12-31"), null);
});
