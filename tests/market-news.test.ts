import assert from "node:assert/strict";
import { test } from "node:test";
import { createMarketNewsReader, parseMarketNews } from "../src/lib/market-news";

const date = Date.parse("2026-11-20T09:00:00Z");
const input = (code: string, title: string, showTime: string) => ({ code, title, showTime });
const sample = input("202611203936156662", "样本市场快讯", "2026-11-20 16:59:10");

test("market news accepts Beijing timestamps, orders and deduplicates headlines, and rejects invalid records", () => {
  const feed = parseMarketNews({ data: { fastNewsList: [
    { ...sample, code: "202611203936156600", showTime: "2026-11-20 16:58:00" },
    { ...sample, url: "javascript:alert(1)" },
    input("invalid", "无效编号", sample.showTime),
    input("202611203936156663", "", sample.showTime),
    input("202611203936156664", "远期时间", "2026-12-01 15:00:00"),
    input("202611203936156665", "无效时间", "2026-02-30 15:00:00"),
    input("202611203936156666", "较早快讯", "2026-11-20 16:57:00"),
  ] } }, date);
  assert.equal(feed.length, 2);
  assert.deepEqual(feed[0], { id: sample.code, title: sample.title, publishAt: "2026-11-20T08:59:10.000Z",
    url: "https://finance.eastmoney.com/a/202611203936156662.html" });
});

test("one upstream request serves concurrent readers, including cache and outage recovery", async () => {
  const items = parseMarketNews({ data: { fastNewsList: [sample] } }, date);
  let now = date;
  let calls = 0;
  const read = createMarketNewsReader(async () => {
    if (++calls === 2) throw new Error("timeout");
    return items;
  }, () => now);
  const [a, b] = await Promise.all([read(), read()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(a?.stale, false);
  now += 46_000;
  const stale = await read();
  assert.deepEqual(stale, { ...a, stale: true });
  assert.equal(await read(), stale);
  assert.equal(calls, 2);
  now += 30_000;
  assert.equal((await read())?.stale, false);
});
