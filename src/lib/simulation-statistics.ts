export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function standardNormal(random: () => number) {
  return Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
}

export function summarizePrices(prices: number[]) {
  const ordered = [...prices].sort((a, b) => a - b);
  const count = ordered.length;
  if (!count) return null;
  const quantile = (p: number) => {
    const index = (count - 1) * p;
    const lower = Math.floor(index);
    return ordered[lower] + (ordered[Math.ceil(index)] - ordered[lower]) * (index - lower);
  };
  const mean = ordered.reduce((sum, price) => sum + price, 0) / count;
  const width = (ordered[count - 1] - ordered[0]) / 20 || 1;
  const histogram = Array.from({ length: 20 }, (_, i) => ({ bin: ordered[0] + width * (i + 0.5), count: 0 }));
  for (const price of ordered) histogram[Math.min(19, Math.floor((price - ordered[0]) / width))].count++;
  return {
    samples: count, p5: quantile(0.05), p25: quantile(0.25), median: quantile(0.5),
    p75: quantile(0.75), p95: quantile(0.95), mean,
    stdDev: Math.sqrt(ordered.reduce((sum, price) => sum + (price - mean) ** 2, 0) / count),
    histogram,
  };
}
