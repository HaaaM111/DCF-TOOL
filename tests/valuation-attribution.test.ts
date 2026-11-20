import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanAttribution, comparableEvidence } from "../src/lib/valuation-attribution";
import { selectPrimaryValuation, type OperatingPublication } from "../src/lib/primary-valuation";

const publication: OperatingPublication = {
  revision: "a".repeat(64), ticker: "603786.SH", price: 35.54, equityValueUnits: 14e9,
  currency: "CNY", valuationDate: "2025-12-31", informationCutoff: "2026-04-30",
  publishedAt: "2026-05-01T00:00:00.000Z", retrospective: false,
  wacc: 0.09, terminalValueShare: 0.9, comparableQuote: 37,
};

test("attribution admits only the same publication, market date and currency", () => {
  const company = { ticker: publication.ticker };
  const primary = selectPrimaryValuation(company, publication);
  const peerSelection = { currency: "CNY", quoteDate: "2025-12-31", period: "2024-12-31" };
  const row = { primaryValuation: primary, relativeValue: 150, diffRate: 7, peerSelection };
  assert.deepEqual(comparableEvidence(primary, row), {
    equityValueHundredMillions: 150, differencePct: 7, quoteDate: "2025-12-31", financialPeriod: "2024-12-31",
  });
  assert.equal(comparableEvidence(primary, { ...row, peerSelection: { ...peerSelection, currency: "HKD" } }), null);
  assert.equal(comparableEvidence(primary, { ...row, peerSelection: { ...peerSelection, quoteDate: "2026-04-30" } }), null);
  assert.equal(comparableEvidence(selectPrimaryValuation(company, { ...publication, revision: "b".repeat(64) }), row), null);
  assert.equal(comparableEvidence(selectPrimaryValuation(company, { ...publication, retrospective: true }), row), null);
});

test("AI prose cannot add numeric claims to the evidence", () => {
  const cleaned = cleanAttribution("终值较敏感；上行空间为＋２５.５％、三成或百分之四十，请按同日数据核验。");
  assert.equal(cleaned, "终值较敏感;上行空间为［数值见证据］、［数值见证据］或［数值见证据］,请按同日数据核验。");
});
