import { prisma, prismaBase } from "./prisma";

/** 基准库 Company 行类型 */
type BaseCompany = {
  id: string;
  name: string;
  ticker: string;
  [key: string]: unknown;
};

/**
 * 把基准公司 + 用户库评估快照 + 假设合并为与旧单库结构一致的 company 对象。
 * 快照字段（targetPrice/upside/quadrant 等）直接展开到 company 顶层。
 */
export async function mergeCompanySnapshot(
  base: BaseCompany,
): Promise<Record<string, unknown>> {
  const [assumption, snapshot] = await Promise.all([
    prisma.assumption.findUnique({ where: { companyId: base.id } }),
    prisma.companySnapshot.findUnique({ where: { companyId: base.id } }),
  ]);

  const out: Record<string, unknown> = { ...base };

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

/** 全部标的（含快照与假设），供排行榜使用，按基准库 updatedAt 倒序 */
export async function getAllCompaniesMerged() {
  const companies = await prismaBase.company.findMany({
    orderBy: { updatedAt: "desc" },
  });
  return Promise.all(companies.map((c) => mergeCompanySnapshot(c)));
}

/** 单个标的（含快照、假设、时间线），供模型编辑/报告页使用 */
export async function getCompanyMerged(id: string) {
  const base = await prismaBase.company.findUnique({ where: { id } });
  if (!base) return null;

  const [merged, timeline] = await Promise.all([
    mergeCompanySnapshot(base),
    prisma.timelineEntry.findMany({
      where: { companyId: id },
      orderBy: { date: "desc" },
    }),
  ]);
  merged.timeline = timeline;
  return merged;
}
