import { z } from "zod";
import { compareMultiples, type Comparable } from "./relative-multiples";
import { isFinancialIndustry } from "./industry-catalog";

export const industryNameSchema = z.string().trim().min(1).max(50).regex(/^[\p{L}\p{N}._&-]+$/u);
const memberSchema = z.object({
  ticker: z.string().regex(/^\d{6}\.(SH|SZ)$/), name: z.string().min(1).max(80), reason: z.string().min(1).max(120),
});
const dataSource = z.enum(["ifind", "eastmoney"]);
const number = z.number().finite().nullable();

export const industrySnapshotSchema = z.object({
  industry: industryNameSchema,
  date: z.iso.date(),
  period: z.string().regex(/^\d{4}-12-31$/),
  collectedAt: z.iso.datetime(),
  currency: z.literal("CNY"),
  samples: z.array(memberSchema.extend({
    close: z.number().positive(), shares: z.number().positive(), marketCap: z.number().positive(),
    netIncome: number, equity: number, revenue: number, netCash: number, ebit: number, ebitda: number,
    financialSource: dataSource, quoteSource: dataSource, cashSource: dataSource.nullable(),
    equitySource: dataSource.nullable().optional(),
    supplementalSource: z.string().nullable(),
  })).min(1),
  excluded: z.array(memberSchema.extend({ excluded: z.string() })),
}).superRefine((snapshot, ctx) => {
  const members = [...snapshot.samples, ...snapshot.excluded];
  if (new Set(members.map(({ ticker }) => ticker)).size !== members.length || snapshot.period > snapshot.date) {
    ctx.addIssue({ code: "custom", message: "样本代码须唯一，年报期不得晚于收盘日" });
  }
});

export type IndustrySnapshot = z.infer<typeof industrySnapshotSchema>;
export type IndustrySample = IndustrySnapshot["samples"][number];

export function comparableFromSample(sample: IndustrySample, industry: string): Comparable {
  const canUseEv = !isFinancialIndustry(industry);
  return { ticker: sample.ticker, name: sample.name, marketCap: sample.marketCap, e0: sample.netIncome ?? NaN,
    bookValue: sample.equity ?? NaN, revenue: sample.revenue ?? NaN, netCash: canUseEv ? sample.netCash ?? undefined : undefined,
    ebit: sample.ebit ?? undefined, ebitda: sample.ebitda ?? undefined };
}

export function describeIndustrySnapshot(snapshot: IndustrySnapshot) {
  const samples = snapshot.samples.map((sample) => comparableFromSample(sample, snapshot.industry));
  const placeholder: Comparable = { ticker: "", name: "", marketCap: 0, e0: 0, bookValue: 0, revenue: 0 };
  const { methods } = compareMultiples(placeholder, samples);
  return {
    ...snapshot,
    methods: methods.map(({ name, count, mean, median }) => ({ name, count, mean, median })),
    samples: snapshot.samples.map((sample, index) => ({ ...sample,
      multiples: Object.fromEntries(compareMultiples(samples[index], []).methods.map(({ name, current }) => [name, current])),
    })),
  };
}

export type IndustrySnapshotView = ReturnType<typeof describeIndustrySnapshot>;
