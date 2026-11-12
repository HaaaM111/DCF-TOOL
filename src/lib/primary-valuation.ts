import { z } from "zod";

export const operatingPublicationSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  ticker: z.string(),
  price: z.number(),
  equityValueUnits: z.number(),
  currency: z.enum(["CNY", "HKD", "USD"]),
  valuationDate: z.iso.date(),
  informationCutoff: z.iso.date(),
  publishedAt: z.iso.datetime(),
  retrospective: z.boolean(),
  wacc: z.number(),
  terminalValueShare: z.number().nullable(),
  comparableQuote: z.number().positive().nullable(),
});

export type OperatingPublication = z.infer<typeof operatingPublicationSchema>;
export type PrimaryValuation =
  | { kind: "operating"; price: number; upside: number | null; publication: OperatingPublication }
  | { kind: "legacy"; price: number; upside: null; reason: string }
  | { kind: "unavailable"; price: null; upside: null; reason: string };

/** Legacy models use user assumptions with no frozen market and financial snapshot. */
export function selectPrimaryValuation(company: Record<string, unknown>, publication: OperatingPublication | null): PrimaryValuation {
  if (publication && publication.ticker === String(company.ticker).toUpperCase()) {
    return {
      kind: "operating", price: publication.price, publication,
      upside: publication.comparableQuote === null || publication.retrospective ? null : (publication.price / publication.comparableQuote - 1) * 100,
    };
  }
  const { cash, debt, netCash, netCashAdj, targetPrice } = company;
  if (cash === 0 && typeof debt === "number" && debt > 0 && (netCashAdj ?? 0) === 0) {
    return { kind: "unavailable", price: null, upside: null, reason: "货币资金为零且有息负债非零，请核验同一期报表中的现金和有息负债。" };
  }
  if (typeof cash === "number" && typeof debt === "number" && typeof netCash === "number"
    && Math.abs(cash - debt + Number(netCashAdj ?? 0) - netCash) > 0.011) {
    return { kind: "unavailable", price: null, upside: null, reason: "净现金与现金、债务及调整项未勾稽。" };
  }
  if (typeof targetPrice !== "number" || !Number.isFinite(targetPrice)) {
    return { kind: "unavailable", price: null, upside: null, reason: "尚无已计算的估值底稿。" };
  }
  return { kind: "legacy", price: targetPrice, upside: null, reason: "简化股东回报模型。需核验基准现金流，并提供带期间和来源的经营预测。" };
}
