import { prisma } from "./prisma";
import { activeOperatingKey, getOperatingPublication, parseOperatingPublication } from "./operating-model-store";
import { selectPrimaryValuation, type OperatingPublication } from "./primary-valuation";

/** 用户库 Company 行类型（界面唯一数据源） */
type CompanyRow = {
  id: string;
  name: string;
  ticker: string;
  [key: string]: unknown;
};

/**
 * 把公司档案 + 评估快照 + 假设合并为与旧单库结构一致的 company 对象。
 * 快照字段（targetPrice/upside/quadrant 等）直接展开到 company 顶层。
 */
export async function mergeCompanySnapshot(
  company: CompanyRow,
  knownPublication?: OperatingPublication | null,
): Promise<Record<string, unknown>> {
  const [assumption, snapshot, publication] = await Promise.all([
    prisma.assumption.findUnique({ where: { companyId: company.id } }),
    prisma.companySnapshot.findUnique({ where: { companyId: company.id } }),
    knownPublication === undefined ? getOperatingPublication(company.id) : knownPublication,
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
  const primary = selectPrimaryValuation(out, publication);
  out.primaryValuation = primary;
  out.legacyTargetPrice = out.targetPrice ?? null;
  out.targetPrice = primary.price;
  out.upside = primary.upside;
  return out;
}

/** 全部标的（含快照与假设），供排行榜使用，按更新时间倒序 */
export async function getAllCompaniesMerged() {
  const companies = await prisma.company.findMany({
    orderBy: { updatedAt: "desc" },
  });
  const active = await prisma.appSetting.findMany({ where: { key: { startsWith: activeOperatingKey("") } } });
  const publications = new Map(active.map(({ key, value }) => [key, parseOperatingPublication(value)]));
  return Promise.all(companies.map((c) => mergeCompanySnapshot(c, publications.get(activeOperatingKey(c.id)) ?? null)));
}

/** 单个标的（含快照、假设、时间线），供模型编辑/报告页使用 */
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
