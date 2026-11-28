import assert from "node:assert/strict";
import test from "node:test";
import { simulateWithJumps } from "../src/lib/jump-simulation";
import { summarizePrices } from "../src/lib/simulation-statistics";
import { assumptionsSchema } from "../src/lib/validation";

const assumptions = assumptionsSchema.parse({
  baseFcf: 10, g1: .05, g2: .03, g3: .02, perpetualG: .01, ke: .13,
  payoutRate1: .6, payoutRate2: .8, e1: 4, e2: 5, e3: 6,
  reverseR: .12, exitPe: 7, transitionG: .02, terminalProfitEst: 40,
});
const company = { currentPrice: 37, shares: 4, netCash: -1, e0: 7.5 };

test("invalid perpetual growth draws are dropped without discarding the valid draws", () => {
  const inputs = assumptionsSchema.parse({ ...assumptions, perpetualG: -.9 });
  const config = { samples: 3000, seed: 42 };
  const result = simulateWithJumps(inputs, company, config);
  assert.equal(result.samples, 1953);
  assert.equal(result.rejected, 1047);
  assert.equal(result.histogram.reduce((sum, bin) => sum + bin.count, 0), result.samples);
  assert.deepEqual(result, simulateWithJumps(inputs, company, config));
});

test("downward shocks reduce P5 and median for both positive and negative cash flow", () => {
  const config = { samples: 3000, seed: 42, jump: { enabled: true, lambda: .5, mean: -.2, std: 0 } };
  for (const baseFcf of [10, -10]) {
    const result = simulateWithJumps({ ...assumptions, baseFcf }, company, config);
    assert.ok(result.jump!.p5 < result.base!.p5);
    assert.ok(result.jump!.median < result.base!.median);
  }
});

test("a constant distribution places every observation in a bin centered on its value", () => {
  const stats = summarizePrices(Array(100).fill(35.535639));
  assert.deepEqual(stats?.histogram, [{ bin: 35.535639, count: 100 }]);
  assert.equal(stats?.p5, stats?.p95);
});
