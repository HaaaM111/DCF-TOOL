import { z } from "zod";
import { calcForwardDcf } from "./dcf";
import { seededRandom, standardNormal, summarizePrices } from "./simulation-statistics";
import type { CompanyBasics, DcfAssumptions, MonteCarloResult } from "@/types/dcf";

export const jumpSchema = z.object({
  enabled: z.boolean().default(false),
  lambda: z.number().min(0).max(5).default(0.1),
  mean: z.number().min(-2).max(1).default(-0.2),
  std: z.number().min(0).max(1).default(0.1),
});
export const simulationConfigSchema = z.object({
  samples: z.number().int().min(100).max(20000).default(3000),
  seed: z.number().int().min(0).max(4294967295).default(42),
  jump: jumpSchema.optional(),
});

function poisson(random: () => number, lambda: number) {
  const limit = Math.exp(-lambda);
  let count = 0;
  let product = random();
  while (product > limit) {
    count += 1;
    product *= random();
  }
  return count;
}

function summary(prices: number[], currentPrice: number) {
  const stats = summarizePrices(prices);
  if (!stats) throw new Error("没有有效模拟样本");
  return { ...stats, pricePercentile: prices.filter((price) => price <= currentPrice).length / stats.samples * 100 };
}

/** Paired DCF scenarios with annual compound-Poisson shocks to signed cash flows. */
export function simulateWithJumps(a: DcfAssumptions, b: CompanyBasics, raw: unknown): MonteCarloResult {
  const config = simulationConfigSchema.parse(raw);
  const rates = seededRandom(config.seed);
  const jumps = seededRandom(config.seed ^ 0xdeadbeef);
  const basePrices: number[] = [];
  const jumpPrices: number[] = [];
  const jump = config.jump?.enabled ? config.jump : undefined;

  for (let index = 0; index < config.samples; index += 1) {
    const sampled = {
      ...a,
      g1: a.g1 + standardNormal(rates) * Math.max(.005, Math.abs(a.g1) * .3),
      g2: a.g2 + standardNormal(rates) * Math.max(.005, Math.abs(a.g2) * .3),
      g3: a.g3 + standardNormal(rates) * Math.max(.005, Math.abs(a.g3) * .3),
      perpetualG: a.perpetualG + standardNormal(rates) * Math.max(.003, Math.abs(a.perpetualG) * .3),
      ke: a.ke + standardNormal(rates) * .015,
    };
    const growths = [sampled.g1, sampled.g2, sampled.g3, sampled.perpetualG];
    if (sampled.ke <= 0 || sampled.ke > 1 || sampled.ke - sampled.perpetualG <= .001
        || growths.some((rate) => rate <= -1 || rate >= 10)) continue;

    try {
      const base = calcForwardDcf(sampled, b, { requireFinite: true }).adjustedTargetPrice;
      const shocks = jump && jump.lambda > 0 ? Array.from({ length: 20 }, () => {
        const count = poisson(jumps, jump.lambda);
        let shock = 0;
        for (let event = 0; event < count; event += 1) shock += jump.mean + jump.std * standardNormal(jumps);
        return shock;
      }) : undefined;
      const stressed = shocks
        ? calcForwardDcf(sampled, b, { cashFlowLogShocks: shocks, requireFinite: true }).adjustedTargetPrice
        : base;
      basePrices.push(base);
      if (jump) jumpPrices.push(stressed);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }

  const base = summary(basePrices, b.currentPrice);
  const stressed = jump ? summary(jumpPrices, b.currentPrice) : undefined;
  const percentiles = ({ p5, p95, median }: ReturnType<typeof summary>) => ({ p5, p95, median });
  return {
    ...(stressed ?? base),
    base: percentiles(base),
    ...(stressed ? { jump: percentiles(stressed) } : {}),
    seed: config.seed,
    rejected: config.samples - base.samples,
  };
}
