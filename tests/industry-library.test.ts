import assert from "node:assert/strict";
import test from "node:test";
import { industryCatalog, industryForIssuer } from "../src/lib/industry-catalog";
import { comparableFromSample, describeIndustrySnapshot, industrySnapshotSchema } from "../src/lib/industry-snapshot";
import { compareMultiples } from "../src/lib/relative-multiples";

test("known issuers use reviewed business groups and broad auto labels do not pool unrelated companies", () => {
  const books = industryCatalog([{ ticker: "600066.SH", name: "宇通", industry: "汽车整车" }]);
  assert.ok(books.get("商用客车")?.has("600066.SH"));
  assert.ok(!books.get("综合乘用车")?.has("600066.SH"));
  assert.equal(books.get("汽车玻璃")?.size, 1);
  assert.equal(books.get("汽车电子")?.size, 4);
  assert.equal(industryForIssuer({ ticker: "600099.SH", name: "未细分", industry: "汽车零部件" }), null);
  assert.equal(industryForIssuer({ ticker: "00700.HK", name: "港股", industry: "互联网" }), null);
});

const sample = {
  ticker: "600660.SH", name: "样本", reason: "测试行业", close: 50, shares: 5, marketCap: 250,
  netIncome: 10, equity: 20, revenue: 50, netCash: -20, ebit: null, ebitda: null,
  financialSource: "ifind", quoteSource: "eastmoney", cashSource: "ifind", supplementalSource: null,
};
const raw = {
  industry: "汽车玻璃", date: "2026-11-20", period: "2025-12-31", collectedAt: "2026-11-22T06:00:00Z", currency: "CNY",
  samples: [
    sample, { ...sample, ticker: "600001.SH", netIncome: -10 }, { ...sample, ticker: "600002.SH", netIncome: 5 },
    { ...sample, ticker: "600003.SH", netIncome: 20 },
  ], excluded: [],
};

test("samples preserve losses while excluding invalid denominator and unknown indicators per multiple", () => {
  const snapshot = industrySnapshotSchema.parse(raw);
  const view = describeIndustrySnapshot(snapshot);
  assert.equal(view.samples[1].multiples["P/E"], null);
  assert.equal(view.methods.find(({ name }) => name === "P/E")?.median, 25);
  assert.equal(view.methods.find(({ name }) => name === "P/B")?.count, 4);
  assert.equal(view.methods.find(({ name }) => name === "EV/EBITDA")?.count, 0);
  const [subject, ...peers] = snapshot.samples.map((row) => comparableFromSample(row, snapshot.industry));
  const relative = compareMultiples(subject, peers);
  assert.equal(relative.methods.find(({ name }) => name === "P/E")?.count, 2);
  assert.equal(relative.methods.find(({ name }) => name === "P/E")?.equityValue, null);
  assert.equal(relative.methods.find(({ name }) => name === "P/B")?.equityValue, 250);
  assert.equal(describeIndustrySnapshot({ ...snapshot, industry: "银行" }).samples[0].multiples["EV/Revenue"], null);
});

test("duplicate and forward-report snapshots fail validation", () => {
  assert.equal(industrySnapshotSchema.safeParse({ ...raw, samples: [sample, sample] }).success, false);
  assert.equal(industrySnapshotSchema.safeParse({ ...raw, date: "2025-10-31" }).success, false);
});
