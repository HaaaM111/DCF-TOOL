/**
 * 输入校验 Schema（Zod）
 * 所有用户输入（财务参数、文本记录、导入 JSON）必须先经过这里校验，
 * 杜绝类型错误、越界数值与注入风险。
 */
import { z } from "zod";

/** 财务数值：必须为有限数字，NaN/Infinity 拒绝 */
const finiteNumber = z
  .number()
  .refine((v) => Number.isFinite(v), "必须为有限数字");

/** 非负数值 */
const nonNegative = finiteNumber.refine((v) => v >= 0, "不能为负数");

/** 比率（0~1） */
const ratio = finiteNumber.refine((v) => v >= 0 && v <= 1, "取值范围 0~1");

/** 增长率（允许负，但限制在 ±100% 防止爆炸） */
const growthRate = finiteNumber.refine(
  (v) => v > -1 && v < 10,
  "增长率应在 (-1, 10) 之间",
);

/** 折现率（0~1） */
const discountRate = finiteNumber.refine((v) => v > 0 && v <= 1, "折现率应在 (0, 1]");

/** 文本最大长度 */
const maxText = (n: number) => z.string().trim().max(n);

/** 股票代码：字母数字+点，如 600104.sh */
const tickerSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9.]+$/, "股票代码只能包含字母、数字和点");

/** 正数 */
const positiveNumber = finiteNumber.refine((v) => v > 0, "必须为正数");

/** 公司基础数据校验 */
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

/** 模型假设校验 */
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

/** 时间线记录校验 */
export const timelineEntrySchema = z.object({
  date: z.string().refine((v) => !isNaN(Date.parse(v)), "日期格式无效"),
  content: maxText(2000).min(1, "内容不能为空"),
  tags: maxText(100).default(""), // 标签，逗号分隔
});

// 向后兼容别名
export const timelineNoteSchema = timelineEntrySchema;

/** 导入 JSON 的整体 Schema（数组，每项为公司+假设） */
export const importSchema = z.array(
  z.object({
    company: companySchema,
    assumptions: assumptionsSchema.optional(),
  }),
);

export type CompanyInput = z.infer<typeof companySchema>;
export type AssumptionsInput = z.infer<typeof assumptionsSchema>;
