import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { calculateOperatingValuation } from "./operating-valuation";
import { operatingModelInputSchema, type OperatingModelInput } from "./operating-model-input";
import { operatingPublicationSchema, type OperatingPublication } from "./primary-valuation";

export const activeOperatingKey = (id: string) => `operating_model_active:${id}`;
export const operatingRevisionPrefix = (id: string) => `operating_model_revision:${id}:`;

export function parseOperatingPublication(value?: string): OperatingPublication | null {
  if (!value) return null;
  try { return operatingPublicationSchema.parse(JSON.parse(value)); } catch { return null; }
}

export async function getOperatingPublication(companyId: string) {
  const active = await prisma.appSetting.findUnique({ where: { key: activeOperatingKey(companyId) } });
  return parseOperatingPublication(active?.value);
}

export async function getOperatingRevision(companyId: string, revision: string) {
  const row = await prisma.appSetting.findUnique({ where: { key: operatingRevisionPrefix(companyId) + revision } });
  return row ? operatingModelInputSchema.parse(JSON.parse(row.value)) : null;
}

export async function publishOperatingModel(companyId: string, input: OperatingModelInput, expectedRevision: string | null) {
  const result = calculateOperatingValuation(input);
  const serialized = JSON.stringify(input);
  const inputVersion = input.openingBalance || input.forecastDrivers ? "operating-drivers-v1" : result.model;
  const revision = createHash("sha256").update(inputVersion).update("\0").update(serialized).digest("hex");
  const scale = { ones: 1, millions: 1e6, hundredMillions: 1e8 }[input.scale];
  if (!result.reconciliation.passed) return { error: "reconciliation" } as const;

  return prisma.$transaction(async (tx) => {
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { ticker: true } });
    if (!company) return { error: "not_found" } as const;
    if (company.ticker.toUpperCase() !== input.ticker) return { error: "ticker" } as const;
    const key = activeOperatingKey(companyId);
    const active = await tx.appSetting.findUnique({ where: { key } });
    const existing = parseOperatingPublication(active?.value);
    if (existing?.revision === revision) return { publication: existing };
    if ((existing?.revision ?? null) !== expectedRevision) return { error: "conflict" } as const;
    const publication = operatingPublicationSchema.parse({
      revision, ticker: input.ticker, price: result.prices.reoi, equityValueUnits: result.bridge.equityValue * scale,
      currency: input.currency, valuationDate: result.valuationDate, informationCutoff: input.informationCutoff,
      publishedAt: new Date().toISOString(), retrospective: result.retrospective, wacc: input.wacc,
      terminalValueShare: result.terminal.operatingValueShare,
      comparableQuote: result.marketComparable ? input.quote?.price ?? null : null,
    });
    const revisionKey = operatingRevisionPrefix(companyId) + revision;
    await tx.appSetting.upsert({ where: { key: revisionKey }, create: { key: revisionKey, value: serialized }, update: {} });
    const value = JSON.stringify(publication);
    await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return { publication };
  });
}
