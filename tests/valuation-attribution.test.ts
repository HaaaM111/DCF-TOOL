import assert from "node:assert/strict";
import { test } from "node:test";
import { attributionModelContext, cleanAttribution, comparableEvidence, compareAttributionPrice, parseAttributionAnalysis,
  scenarioEvidence, type ValuationAttributionEvidence } from "../src/lib/valuation-attribution";
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

const comparablePrice = {
  price: 35.54, currency: "CNY", valuationDate: "2025-12-31", verified: true, alignedEligible: true,
  referenceReason: "估值与行情日期不同",
  quote: { price: 35.30, date: "2025-12-31", currency: "CNY", source: "eastmoney" as const },
};

test("price direction is deterministic for same-day quotes and rounded to the displayed precision", () => {
  const above = compareAttributionPrice(comparablePrice);
  assert.equal(above.mode, "aligned");
  assert.equal(above.direction, "above");
  assert.equal(above.difference, .24);
  assert.ok(above.differencePct! > 0);
  const below = compareAttributionPrice({ ...comparablePrice, price: 35.20 });
  assert.equal(below.direction, "below");
  assert.equal(below.difference, -.1);
  assert.equal(compareAttributionPrice({ ...comparablePrice, price: 35.3001 }).direction, "flat");
});

test("cross-period and retrospective comparisons retain direction only and reject mixed currency or an unverified model", () => {
  const crossPeriod = compareAttributionPrice({ ...comparablePrice, quote: { ...comparablePrice.quote, date: "2026-11-20" } });
  assert.equal(crossPeriod.mode, "reference");
  assert.equal(crossPeriod.direction, "above");
  assert.equal(crossPeriod.differencePct, null);
  assert.equal(compareAttributionPrice({ ...comparablePrice, alignedEligible: false }).mode, "reference");
  assert.equal(compareAttributionPrice({ ...comparablePrice, currency: "HKD" }).direction, null);
  assert.equal(compareAttributionPrice({ ...comparablePrice, verified: false }).direction, null);
  assert.equal(compareAttributionPrice({ ...comparablePrice, quote: null }).mode, "unavailable");
});

test("AI interpretations are restricted to supplied topics and do not add cross-period trading claims", () => {
  const drivers = [
    { topic: "rates", explanation: "折现率上调到两成后，基准估值下降。" },
    { topic: "growth", explanation: "永续增长率支撑经营终值。" },
    { topic: "peers", explanation: "同行中位数支持另一种市场预期。" },
    { topic: "cashflow", explanation: "跨期价差缩小，证明股价明显低估。" },
  ];
  const check = "核对长期盈利和再投资能否同时兑现。";
  const parsed = parseAttributionAnalysis(JSON.stringify({ drivers, check }), ["rates", "cashflow"], true);
  assert.deepEqual(parsed?.drivers, [{ topic: "rates", explanation: "折现率上调到［数值见证据］后,基准估值下降。" }]);
  assert.equal(parseAttributionAnalysis(JSON.stringify({ drivers, check: "股价必然上涨，建议买入。" }), ["rates"], false)?.check,
    "核对底稿的关键假设及其财报依据。");
  const conflated = [...drivers, { topic: "bridge", explanation: "净金融资产和留存现金共同推高经营估值。" }];
  assert.deepEqual(parseAttributionAnalysis(JSON.stringify({ drivers: conflated, check }), ["rates", "bridge"], true, "operating")
    ?.drivers.map(({ topic }) => topic), ["rates"]);
  assert.equal(parseAttributionAnalysis(JSON.stringify({ drivers: [
    { topic: "cashflow", explanation: "再投资超过经营利润会拉高未来自由现金流。" },
    { topic: "rates", explanation: "永续增速用于终值折现，决定当前估值。" },
  ], check }), ["cashflow", "rates"], true, "operating"), null);
  assert.equal(parseAttributionAnalysis(JSON.stringify({ drivers: [
    { topic: "cashflow", explanation: "当期税后经营利润扣除净再投资得到模型现金流。" },
  ], check }), ["cashflow"], true, "legacy"), null);
});

test("scenario positions and provider context do not ask the model to calculate market gaps", () => {
  const primary = selectPrimaryValuation({ ticker: publication.ticker }, publication);
  const evidence: ValuationAttributionEvidence = {
    ticker: publication.ticker, companyName: "示例", primary, terminalGrowth: .028, reconciliation: "passed",
    comparables: null, comparison: compareAttributionPrice(comparablePrice), peers: null, announcements: [],
    model: { kind: "operating", currency: "CNY", rate: .095, growth: .028,
      explicitPerShare: 3.30, terminalPerShare: 31.43, terminalShare: .91, netFinancialAssetsPerShare: 1.04,
      minorityPerShare: -.22, retainedPerShare: null, forecasts: [], impliedGrowth: null,
      sensitivity: [{ driver: "rate", shift: .01, price: 29.96 }, { driver: "growth", shift: .005, price: 36.93 }],
    },
  };
  assert.deepEqual(scenarioEvidence(evidence), [{ driver: "rate", shift: .01, price: 29.96, position: "crosses" }]);
  const context = attributionModelContext(evidence);
  assert.equal(context.comparison.side, "模型价较高");
  assert.equal(context.model?.scenarios[0].effectOnModelPrice, "负向");
  assert.equal(JSON.stringify(context).includes("35.54"), false);
});
