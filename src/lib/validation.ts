import { z } from "zod";

const finiteNumber = z
  .number()
  .refine((v) => Number.isFinite(v), "必须为有限数字");

const nonNegative = finiteNumber.refine((v) => v >= 0, "不能为负数");

const ratio = finiteNumber.refine((v) => v >= 0 && v <= 1, "取值范围 0~1");

const growthRate = finiteNumber.refine(
  (v) => v > -1 && v < 10,
  "增长率应在 (-1, 10) 之间",
);

const discountRate = finiteNumber.refine((v) => v > 0 && v <= 1, "折现率应在 (0, 1]");

const maxText = (n: number) => z.string().trim().max(n);

const tickerSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9.]+$/, "股票代码只能包含字母、数字和点");

const positiveNumber = finiteNumber.refine((v) => v > 0, "必须为正数");

export const companySchema = z.object({
  name: maxText(50).min(1, "标的简称为必填"),
  ticker: tickerSchema,
  currentPrice: nonNegative,
  shares: nonNegative,
  marketCap: nonNegative,
  cash: finiteNumber,
  debt: finiteNumber,
  netCashAdj: finiteNumber.default(0),
  netCash: finiteNumber,
  e0: finiteNumber,
  revenue: finiteNumber.default(0),
  bookValue: finiteNumber.default(0),
  cfo: finiteNumber,
  capex: finiteNumber,
  da: finiteNumber,
  industry: z.string().max(50).default(""),
  fxRate: positiveNumber.default(1),
  kd: discountRate.default(0.036),
  taxRate: ratio.default(0.2),
  quadrant: z.string().max(50).default(""),
  diagnosis: z.string().max(50).default(""),
});

export const assumptionsSchema = z.object({
  baseFcf: finiteNumber,
  g1: growthRate,
  g2: growthRate,
  g3: growthRate,
  perpetualG: growthRate,
  ke: discountRate,
  payoutRate1: ratio,
  payoutRate2: ratio,
  e1: finiteNumber,
  e2: finiteNumber,
  e3: finiteNumber,
  reverseR: discountRate,
  exitPe: nonNegative,
  transitionG: growthRate,
  terminalProfitEst: finiteNumber,
  crpName: z.string().max(50).default(""),
  crpBps: finiteNumber.default(0),
});

export const timelineEntrySchema = z.object({
  date: z.string().refine((v) => !isNaN(Date.parse(v)), "日期格式无效"),
  content: maxText(2000).min(1, "内容不能为空"),
  tags: maxText(100).default(""), // 标签，逗号分隔
});

export const timelineNoteSchema = timelineEntrySchema;

export const importSchema = z.array(
  z.object({
    company: companySchema,
    assumptions: assumptionsSchema.optional(),
  }),
);

export type CompanyInput = z.infer<typeof companySchema>;
export type AssumptionsInput = z.infer<typeof assumptionsSchema>;
