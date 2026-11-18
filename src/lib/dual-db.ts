import { prisma } from "./prisma";

type CompanyRow = {
  id: string;
  name: string;
  ticker: string;
  [key: string]: unknown;
};

export async function mergeCompanySnapshot(
  company: CompanyRow,
): Promise<Record<string, unknown>> {
  const [assumption, snapshot] = await Promise.all([
    prisma.assumption.findUnique({ where: { companyId: company.id } }),
    prisma.companySnapshot.findUnique({ where: { companyId: company.id } }),
  ]);

  const out: Record<string, unknown> = { ...company };

  if (snapshot) {
    const snapFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(snapshot)) {
      if (!["id", "companyId", "createdAt", "updatedAt"].includes(k)) {
        snapFields[k] = v;
      }
    }
    Object.assign(out, snapFields);
  }

  out.targetPrice = typeof out.targetPrice === "number" ? out.targetPrice : 0;
  out.upside = typeof out.upside === "number" ? out.upside : 0;
  out.impliedCagr = typeof out.impliedCagr === "number" ? out.impliedCagr : 0;
  out.quadrant = typeof out.quadrant === "string" ? out.quadrant : "";
  out.diagnosis = typeof out.diagnosis === "string" ? out.diagnosis : "";

  out.assumption = assumption;
  return out;
}

export async function getAllCompaniesMerged(userId: string) {
  const companies = await prisma.company.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return Promise.all(companies.map((c) => mergeCompanySnapshot(c)));
}

export async function getCompanyMerged(id: string, userId: string) {
  const company = await prisma.company.findFirst({ where: { id, userId } });
  if (!company) return null;

  const [merged, timeline] = await Promise.all([
    mergeCompanySnapshot(company),
    prisma.timelineEntry.findMany({
      where: { companyId: id },
      orderBy: { date: "desc" },
    }),
  ]);
  merged.timeline = timeline;
  return merged;
}
