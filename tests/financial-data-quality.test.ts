import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesReportPeriod, missingFinancialFields, quoteDateFromUnix } from "../src/lib/financial-data-quality";

test("quote dates retain the exchange day and do not turn absent or stale timestamps into today", () => {
  const now = Date.parse("2026-11-20T03:00:00Z");
  assert.equal(quoteDateFromUnix(Date.parse("2026-11-19T23:30:00Z") / 1000, now), "2026-11-20");
  for (const value of [undefined, 0, NaN, Date.parse("2026-10-01T06:00:00Z") / 1000, (now + 600_000) / 1000])
    assert.equal(quoteDateFromUnix(value, now), null);
});

test("financial gaps distinguish zero and loss from omitted or invalid fields", () => {
  assert.deepEqual(missingFinancialFields({
    cash: 0, debt: null, shares: 0, bookValue: -2, e0: -5,
    cfo: -10, capex: -1, da: undefined, revenue: 1, totalAssets: Infinity,
  }), ["debt", "shares", "capex", "da", "totalAssets"]);
});

test("financial reports must identify the exact requested period", () => {
  assert.ok(matchesReportPeriod("2025-12-31 00:00:00", "2025-12-31"));
  assert.ok(!matchesReportPeriod("2026-09-30 00:00:00", "2025-12-31"));
  assert.ok(!matchesReportPeriod(undefined, "2025-12-31"));
});
