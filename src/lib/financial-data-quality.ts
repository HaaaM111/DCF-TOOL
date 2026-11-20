import { z } from "zod";

export const financialFieldLabels = {
  cash: "货币资金", debt: "有息负债", shares: "总股本", e0: "归母净利润",
  revenue: "营业收入", bookValue: "归母净资产", cfo: "经营现金流",
  capex: "资本开支", da: "折旧", totalAssets: "总资产",
} as const;
export type FinancialField = keyof typeof financialFieldLabels;
export const requiredAutofillFields: FinancialField[] = ["debt", "shares", "e0", "revenue"];

export function missingFinancialFields(fields: Record<FinancialField, number | null | undefined>): FinancialField[] {
  return (Object.keys(financialFieldLabels) as FinancialField[]).filter((key) => {
    const value = fields[key];
    return value == null || !Number.isFinite(value)
      || ((key === "shares" || key === "totalAssets") && value <= 0)
      || ((key === "cash" || key === "debt" || key === "capex" || key === "da" || key === "revenue") && value < 0);
  });
}

export function chinaMarketDate(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function quoteDateFromUnix(seconds: unknown, now = Date.now()) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const timestamp = seconds * 1000;
  if (timestamp < now - 14 * 86_400_000 || timestamp > now + 300_000) return null;
  return chinaMarketDate(new Date(timestamp));
}

export function normalizeQuoteDay(input: string) {
  const date = input.slice(0, 10);
  return z.iso.date().safeParse(date).success ? date : null;
}

export function matchesReportPeriod(value: unknown, expected: string) {
  return typeof value === "string" && normalizeQuoteDay(value) === expected;
}
