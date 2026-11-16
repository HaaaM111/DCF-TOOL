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

  out.assumption = assumption;
  return out;
}

export async function getAllCompaniesMerged() {
  const companies = await prisma.company.findMany({
    orderBy: { updatedAt: "desc" },
  });
  return Promise.all(companies.map((c) => mergeCompanySnapshot(c)));
}

export async function getCompanyMerged(id: string) {
  const company = await prisma.company.findUnique({ where: { id } });
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
