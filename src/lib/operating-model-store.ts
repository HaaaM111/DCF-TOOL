import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { calculateOperatingValuation } from "./operating-valuation";
import { operatingModelInputSchema, type OperatingModelInput } from "./operating-model-input";
import { operatingPublicationSchema, type OperatingPublication } from "./primary-valuation";
import { writeAppSetting } from "./app-setting-write";

export const activeOperatingKey = (id: string) => `operating_model_active:${id}`;
export const operatingRevisionPrefix = (id: string) => `operating_model_revision:${id}:`;
export const operatingPublicationPrefix = (id: string) => `operating_model_publication:${id}:`;

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

export async function getOperatingHistory(companyId: string) {
  const [active, events] = await Promise.all([
    getOperatingPublication(companyId),
    prisma.appSetting.findMany({ where: { key: { startsWith: operatingPublicationPrefix(companyId) } }, orderBy: { key: "desc" }, take: 100 }),
  ]);
  const history = events.map(({ value }) => parseOperatingPublication(value)).filter((item) => item !== null);
  if (active && !history.some((item) => item.revision === active.revision && item.publishedAt === active.publishedAt)) history.push(active);
  return history.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
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
      publishedAt: new Date(Math.max(Date.now(), existing ? Date.parse(existing.publishedAt) + 1 : 0)).toISOString(),
      retrospective: result.retrospective, wacc: input.wacc,
      terminalValueShare: result.terminal.operatingValueShare,
      comparableQuote: result.marketComparable ? input.quote?.price ?? null : null,
    });
    const revisionKey = operatingRevisionPrefix(companyId) + revision;
    await writeAppSetting(tx, revisionKey, serialized, true);
    const value = JSON.stringify(publication);
    const prefix = operatingPublicationPrefix(companyId);
    if (existing) {
      const prior = await tx.appSetting.findFirst({ where: { key: { startsWith: prefix + existing.publishedAt + ":" } } });
      if (!prior) await writeAppSetting(tx, prefix + existing.publishedAt + ":" + randomUUID(), JSON.stringify(existing), true);
    }
    await writeAppSetting(tx, prefix + publication.publishedAt + ":" + randomUUID(), value, true);
    await writeAppSetting(tx, key, value);
    return { publication };
  });
}
