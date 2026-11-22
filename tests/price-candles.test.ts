import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePriceBars, priceRange } from "../src/lib/price-candles";

const daily = [
  { date: "2025-12-31", open: 10, high: 14, low: 9, close: 12 },
  { date: "2026-01-02", open: 12, high: 15, low: 8, close: 11 },
  { date: "2026-01-05", open: 11, high: 13, low: 7, close: 10 },
];

test("candlesticks aggregate to calendar weeks and months using actual trading days", () => {
  assert.equal(aggregatePriceBars(daily, "day").length, 3);
  const weekly = aggregatePriceBars(daily, "week");
  const monthly = aggregatePriceBars([daily[2], daily[0], daily[1]], "month");
  assert.deepEqual(weekly.map(({ date, candle }) => [date, candle]), [
    ["2026-01-02", [10, 11, 8, 15]],
    ["2026-01-05", [11, 10, 7, 13]],
  ]);
  assert.deepEqual(monthly.map(({ date, candle }) => [date, candle]), [
    ["2025-12-31", [10, 12, 9, 14]],
    ["2026-01-05", [12, 10, 7, 15]],
  ]);
});

test("missing and inconsistent ranges are shown as close-only values", () => {
  assert.equal(priceRange(10, 9, 8, 11), null);
  assert.equal(priceRange(0, 15, 8, 11), null);
  const result = aggregatePriceBars([...daily, { date: "2026-01-06", close: 18 }], "month");
  assert.deepEqual(result[1], { firstDate: "2026-01-02", date: "2026-01-06", close: 18, candle: null });
});
