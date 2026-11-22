export type PricePeriod = "day" | "week" | "month";
export type PriceBar = { date: string; close: number; open?: number; high?: number; low?: number; volume?: number };

export function priceRange(open: number, high: number, low: number, close: number) {
  if (![open, high, low, close].every((price) => Number.isFinite(price) && price > 0)
      || low > Math.min(open, close) || high < Math.max(open, close)) return null;
  return { open, high, low };
}

function periodStart(date: string, period: PricePeriod) {
  if (period === "day") return date;
  if (period === "month") return date.slice(0, 7) + "-01";
  const day = new Date(date + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

export function aggregatePriceBars(prices: PriceBar[], period: PricePeriod) {
  const days = new Map(prices.filter((row) => /^\d{4}-\d\d-\d\d$/.test(row.date)
    && Number.isFinite(Date.parse(row.date)) && Number.isFinite(row.close) && row.close > 0)
    .map((row) => [row.date, row]));
  const groups = new Map<string, PriceBar[]>();
  for (const bar of [...days.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = periodStart(bar.date, period);
    const group = groups.get(key);
    if (group) group.push(bar);
    else groups.set(key, [bar]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0], last = group[group.length - 1];
    const ranges = group.map((row) => priceRange(row.open ?? NaN, row.high ?? NaN, row.low ?? NaN, row.close));
    const range = ranges.every((row) => row !== null);
    return {
      firstDate: first.date, date: last.date, close: last.close,
      candle: range ? [ranges[0]!.open, last.close, Math.min(...ranges.map((row) => row!.low)),
        Math.max(...ranges.map((row) => row!.high))] : null,
    };
  });
}
