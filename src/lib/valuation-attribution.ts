import { z } from "zod";
import type { PrimaryValuation } from "./primary-valuation";

const comparableSchema = z.object({
  primaryValuation: z.object({
    kind: z.literal("operating"),
    publication: z.object({ revision: z.string(), price: z.number() }),
  }),
  relativeValue: z.number().positive(),
  diffRate: z.number().nonnegative(),
  peerSelection: z.object({ currency: z.string(), quoteDate: z.iso.date(), period: z.iso.date() }),
});

export function comparableEvidence(primary: PrimaryValuation, value: unknown) {
  const parsed = comparableSchema.safeParse(value);
  if (!parsed.success || primary.kind !== "operating" || primary.upside === null) return null;
  const row = parsed.data;
  if (row.primaryValuation.publication.revision !== primary.publication.revision
    || row.primaryValuation.publication.price !== primary.price
    || row.peerSelection.currency !== primary.publication.currency
    || row.peerSelection.quoteDate !== primary.publication.valuationDate) return null;
  return { equityValueHundredMillions: row.relativeValue, differencePct: row.diffRate,
    quoteDate: row.peerSelection.quoteDate, financialPeriod: row.peerSelection.period };
}

export type ValuationAttributionEvidence = {
  ticker: string;
  primary: PrimaryValuation;
  terminalGrowth: number | null;
  reconciliation: "passed" | "unverified";
  comparables: ReturnType<typeof comparableEvidence>;
};

/** Quantitative claims belong in the deterministic evidence table. */
export function cleanAttribution(text: string) {
  return text.normalize("NFKC").trim().slice(0, 1800)
    .replace(/[-+−]?\p{N}+(?:[.,]\p{N}+)*(?:\s*[%％]|\s*(?:元|亿|倍|年))?/gu, "［数值见证据］")
    .replace(/(?:百分之|千分之)[负零〇一二两三四五六七八九十百千万亿点]+|[负零〇一二两三四五六七八九十百千万亿点]+(?:亿元|万元|元\/股|倍|成|个百分点)/gu, "［数值见证据］");
}
