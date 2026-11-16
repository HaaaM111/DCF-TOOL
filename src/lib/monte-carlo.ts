
import { calcDcf } from "./dcf";
import type { CompanyBasics, DcfAssumptions } from "@/types/dcf";

export interface MonteCarloConfig {
  samples: number;
  seed?: number;
}

export interface MonteCarloResult {
  samples: number;
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  mean: number;
  stdDev: number;
  pricePercentile: number;
  histogram: { bin: number; count: number }[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(rand: () => number, mean: number, std: number): number {
  const u1 = rand();
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
  return mean + z * std;
}

export function runMonteCarlo(
  a: DcfAssumptions,
  b: CompanyBasics,
  config: MonteCarloConfig = { samples: 10000 },
): MonteCarloResult {
  const samples = Math.max(100, Math.min(50000, config.samples));
  const rand = mulberry32(config.seed ?? 42);

  const prices: number[] = [];

  for (let i = 0; i < samples; i++) {
    const g1 = normalSample(rand, a.g1, Math.max(0.005, Math.abs(a.g1) * 0.3));
    const g2 = normalSample(rand, a.g2, Math.max(0.005, Math.abs(a.g2) * 0.3));
    const g3 = normalSample(rand, a.g3, Math.max(0.005, Math.abs(a.g3) * 0.3));
    const perpetualG = normalSample(
      rand,
      a.perpetualG,
      Math.max(0.003, Math.abs(a.perpetualG) * 0.3),
    );
    const perpetualGClamped = Math.max(-0.05, Math.min(0.05, perpetualG));
    const ke = normalSample(rand, a.ke, 0.015);
    const keClamped = Math.max(0.05, Math.min(0.3, ke));

    const sampled: DcfAssumptions = {
      ...a,
      g1,
      g2,
      g3,
      perpetualG: perpetualGClamped,
      ke: keClamped,
    };

    try {
      const output = calcDcf(sampled, b);
      const tp = output.forward.adjustedTargetPrice;
      if (Number.isFinite(tp) && tp > 0) {
        prices.push(tp);
      }
    } catch {
      // 跳过异常采样
    }
  }

  if (prices.length === 0) {
    return {
      samples: 0,
      p5: 0, p25: 0, median: 0, p75: 0, p95: 0,
      mean: 0, stdDev: 0,
      pricePercentile: 0,
      histogram: [],
    };
  }

  prices.sort((x, y) => x - y);
  const n = prices.length;

  const quantile = (p: number) => {
    const idx = Math.min(n - 1, Math.max(0, Math.floor(p * n)));
    return prices[idx];
  };

  const p5 = quantile(0.05);
  const p25 = quantile(0.25);
  const median = quantile(0.5);
  const p75 = quantile(0.75);
  const p95 = quantile(0.95);

  const mean = prices.reduce((s, v) => s + v, 0) / n;
  const variance = prices.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const currentPrice = b.currentPrice;
  let pricePercentile = 0;
  for (let i = 0; i < n; i++) {
    if (prices[i] <= currentPrice) pricePercentile++;
    else break;
  }
  pricePercentile = (pricePercentile / n) * 100;

  const binCount = 20;
  const min = prices[0];
  const max = prices[n - 1];
  const binWidth = (max - min) / binCount || 1;
  const histogram: { bin: number; count: number }[] = [];
  for (let i = 0; i < binCount; i++) {
    histogram.push({ bin: min + binWidth * (i + 0.5), count: 0 });
  }
  for (const p of prices) {
    const idx = Math.min(binCount - 1, Math.floor((p - min) / binWidth));
    histogram[idx].count++;
  }

  return {
    samples: n,
    p5,
    p25,
    median,
    p75,
    p95,
    mean,
    stdDev,
    pricePercentile,
    histogram,
  };
}
