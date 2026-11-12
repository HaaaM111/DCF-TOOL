import assert from "node:assert/strict";
import test from "node:test";
import { analyzeOperatingValuation, operatingAnalysisSchema, workbookScenarioPrice } from "../src/lib/operating-scenarios";
import { mainlandCloseWindow, selectPeerCandidates } from "../src/lib/peer-selection";

const data = {
  ticker: "100001.SH", baseYear: 2025, informationCutoff: "2026-04-30", currency: "CNY", scale: "millions",
  openingSource: { name: "基期示例", availableOn: "2026-04-01" },
  forecastSource: { name: "预测示例", availableOn: "2026-04-30" },
  openingNoa: 100, netFinancialObligations: -10, minorityInterest: 3, shares: 10, wacc: 0.1, terminalGrowth: 0.02,
  forecast: [{ year: 2026, afterTaxOperatingIncome: 12, closingNoa: 115 }, { year: 2027, afterTaxOperatingIncome: 18, closingNoa: 120 }],
};
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10);

test("workbook sensitivity freezes base ReOI and blanks invalid spreads while coherent scenario reprices the capital charge", () => {
  const input = operatingAnalysisSchema.parse({ ...data, scenarios: { sensitivity: { wacc: [0.1, 0.12, 0.12], g: [0.02, 0.12] } } });
  const result = analyzeOperatingValuation(input);
  assert.equal(result.heatmap.length, 4);
  near(result.heatmap[0].workbookPrice!, result.prices.reoi);
  near(result.heatmap[0].coherentPrice!, result.prices.reoi);
  const frozen = (107 + 2 / 1.12 + 6.5 / 1.12 ** 2 + (6.5 * 1.02 / 0.1) / 1.12 ** 2) / 10;
  near(result.heatmap[2].workbookPrice!, frozen);
  assert.ok(result.heatmap[2].coherentPrice! < frozen);
  assert.equal(result.heatmap[3].workbookPrice, null);
  assert.equal(result.heatmap[3].coherentPrice, null);
});

test("scenario simulation is deterministic and reproduces the base case without shocks", () => {
  const config = { samples: 100, seed: 31, waccStd: 0, growthStd: 0 };
  const input = operatingAnalysisSchema.parse({ ...data, scenarios: { simulation: config } });
  const result = analyzeOperatingValuation(input);
  assert.deepEqual(result.simulation, analyzeOperatingValuation(input).simulation);
  near(result.simulation!.workbook!.p95, result.prices.reoi);
  near(result.simulation!.coherent!.p5, result.prices.reoi);
  const stressed = analyzeOperatingValuation(operatingAnalysisSchema.parse({ ...data, scenarios: { simulation: { ...config,
    project: { startYear: 2026, minimum: 30, mode: 30, maximum: 30, baseline: 0, afterTaxMargin: 0.12, assetTurnover: 1.5 },
  } } }));
  near(stressed.simulation!.workbook!.median, workbookScenarioPrice(input, input.wacc, input.terminalGrowth, 2026, 3.6));
  assert.ok(stressed.simulation!.coherent!.median < stressed.simulation!.workbook!.median);
});

test("workbook EV multiples use comparable median, explicit adjustment and equity bridge", () => {
  const companies = [1, 2, 3].map((n) => ({ ticker: `10000${n + 1}.SH`, name: `同行 ${n}`, reason: "同产品",
    marketCap: n * 100, netFinancialObligations: 20, forwardOperatingIncome: 10, openingNoa: 100 }));
  const peers = { source: "测试底稿", quoteDate: "2025-12-31", availableOn: "2026-04-30", adjustment: 0.1, companies };
  const result = analyzeOperatingValuation(operatingAnalysisSchema.parse({ ...data, scenarios: { operatingPeers: peers } }));
  near(result.peerValuation!.methods[0].median!, 22);
  near(result.peerValuation!.methods[0].price!, (22 * 0.9 * 12 + 7) / 10);
  assert.equal(result.peerValuation!.retrospective, true);
  assert.equal(operatingAnalysisSchema.safeParse({ ...data, scenarios: { operatingPeers: { ...peers, companies: [companies[0], companies[0]] } } }).success, false);
  assert.equal(operatingAnalysisSchema.safeParse({ ...data, scenarios: { operatingPeers: { ...peers, availableOn: "2026-05-01" } } }).success, false);
});

test("peer selection uses the reviewed Koboda group and excludes mismatched sectors and listings", () => {
  const candidates = [
    { ticker: "100002.SZ", name: "同业", industry: " 汽车零部件 " },
    { ticker: "100002.SZ", name: "重复", industry: "汽车零部件" },
    { ticker: "100003.SH", name: "其他行业", industry: "有色金属" },
    { ticker: "100004.HK", name: "港股同行", industry: "汽车零部件" },
  ];
  assert.deepEqual(selectPeerCandidates({ ticker: "603786.SH", industry: "" }, candidates).map((p) => p.ticker), ["002920.SZ", "002906.SZ", "600699.SH"]);
  assert.deepEqual(selectPeerCandidates({ ticker: data.ticker, industry: "汽车零部件" }, candidates).map((p) => p.ticker), ["100002.SZ"]);
});

test("mainland quote window excludes today's daily bar before the close", () => {
  assert.deepEqual(mainlandCloseWindow(new Date("2026-11-12T06:59:59Z")), { start: "2026-11-01", end: "2026-11-11" });
  assert.deepEqual(mainlandCloseWindow(new Date("2026-11-12T07:00:00Z")), { start: "2026-11-02", end: "2026-11-12" });
});
