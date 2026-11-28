import assert from "node:assert/strict";
import { test } from "node:test";
import { marketQuoteCaption } from "../src/lib/market-quote";
import { marketCloseWindow, parseIfindMarketQuotes } from "../src/lib/market-quote-service";

test("quote timestamps retain the provider's China time and reject unrelated or invalid data", () => {
  const payload = { errorcode: 0, tables: [
    { thscode: "603786.sh", time: ["2026-11-27 14:30:00", "2026-11-27 14:29:00"], table: { latest: [34.99, 35] } },
    { thscode: "600660.SH", time: ["2026-11-27 16:30:00"], table: { latest: [55.13] } },
    { thscode: "600104.SH", time: ["2026-11-27 14:30:00"], table: { latest: [-1] } },
    { thscode: "600066.SH", time: ["2026-11-27 14:30:00"], table: { latest: [31] } },
    { thscode: "000001.SZ", time: ["2026-10-31 14:30:00"], table: { latest: [11] } },
  ] };
  const quotes = parseIfindMarketQuotes(payload, ["603786.SH", "600660.SH", "600104.SH", "000001.SZ"], new Date("2026-11-27T06:31:00Z"));
  assert.deepEqual([...quotes], [["603786.SH", {
    price: 34.99, date: "2026-11-27", timestamp: "2026-11-27T14:30:00+08:00", kind: "snapshot", source: "ifind",
  }]]);
  assert.equal(marketQuoteCaption(quotes.get("603786.SH"), false), "2026-11-27 14:30:00 · iFinD");
  assert.equal(marketQuoteCaption(null, false), "档案价");
});

test("daily fallback excludes an unfinished session and resolves weekends", () => {
  const weekday = new Date("2026-11-27T07:30:00Z");
  assert.equal(marketCloseWindow("603786.SH", weekday).end, "2026-11-27");
  assert.equal(marketCloseWindow("00700.HK", weekday).end, "2026-11-26");
  assert.equal(marketCloseWindow("603786.SH", new Date("2026-11-29T08:00:00Z")).end, "2026-11-27");
});
