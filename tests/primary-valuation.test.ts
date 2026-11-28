import assert from "node:assert/strict";
import test from "node:test";
import { selectPrimaryValuation, type OperatingPublication } from "../src/lib/primary-valuation";

const company = { ticker: "603786.SH", cash: 0, debt: 9.59, netCash: -9.59, targetPrice: 0.9149025884 };
const publication: OperatingPublication = {
  revision: "a".repeat(64), ticker: company.ticker, price: 35.5356391, equityValueUnits: 14351423207.46,
  currency: "CNY", valuationDate: "2025-12-31", informationCutoff: "2026-11-10", publishedAt: "2026-11-12T09:00:00Z",
  wacc: 0.095, terminalValueShare: 0.9053, retrospective: true, comparableQuote: null,
};

test("unverified cash and an inconsistent equity bridge suppress a legacy target", () => {
  assert.equal(selectPrimaryValuation(company, null).kind, "unavailable");
  assert.equal(selectPrimaryValuation({ ...company, cash: 11.22 }, null).kind, "unavailable");
  assert.deepEqual(selectPrimaryValuation({ ...company, cash: 11.22, netCash: 1.63 }, null), {
    kind: "legacy", price: company.targetPrice, upside: null,
    reason: "简化股东回报模型。需核验基准现金流，并提供带期间和来源的经营预测。",
  });
});

test("a published same-security model overrides the legacy snapshot but retrospective comparisons suppress upside", () => {
  const primary = selectPrimaryValuation(company, publication);
  assert.equal(primary.kind, "operating");
  assert.equal(primary.price, publication.price);
  assert.equal(primary.upside, null);
  assert.equal(selectPrimaryValuation({ ...company, ticker: "000651.SZ" }, publication).kind, "unavailable");
  const sameDate = selectPrimaryValuation(company, { ...publication, price: 36, retrospective: false, comparableQuote: 30 });
  assert.ok(Math.abs(sameDate.upside! - 20) < 1e-10);
});
