/**
 * 数据拆分迁移脚本：dev.db（旧混合库）→ baseline.db（基准）+ user.db（用户）
 * 保留所有记录 id，保证跨库引用（companyId）一致。
 * 用法：npx tsx scripts/migrate-split-db.ts
 */
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaClient as BaseClient } from "../src/generated/prisma-base/client";

// 基于脚本位置动态解析项目根目录（兼容本地与服务器任意部署位置）
const ROOT = path.resolve(__dirname, "..");
const dbUrl = (...segments: string[]) =>
  `file:${path.join(ROOT, ...segments).replace(/\\/g, "/")}`;
const OLD_DB = dbUrl("prisma", "dev.db");
const USER_DB = dbUrl("prisma", "user.db");
const BASE_DB = dbUrl("prisma", "baseline.db");

/** 从 raw 结果中抽取指定字段，并把日期/JSON 列转换为可写类型 */
function pick(
  row: Record<string, unknown>,
  keys: string[],
  dateKeys: string[] = [],
  jsonKeys: string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    let v = row[k];
    if (v === undefined || v === null) {
      out[k] = null;
      continue;
    }
    if (dateKeys.includes(k)) {
      out[k] = new Date(v as string);
      continue;
    }
    if (jsonKeys.includes(k)) {
      try {
        out[k] = JSON.parse(v as string);
      } catch {
        out[k] = null;
      }
      continue;
    }
    out[k] = v;
  }
  return out;
}

async function main() {
  // —— 1. 读旧库 ——
  process.env.DATABASE_URL = OLD_DB;
  const old = new PrismaClient();

  const rawCompanies = (await old.$queryRawUnsafe(
    "SELECT * FROM Company",
  )) as Record<string, unknown>[];
  const rawAssumptions = (await old.$queryRawUnsafe(
    "SELECT * FROM Assumption",
  )) as Record<string, unknown>[];
  const rawReports = (await old.$queryRawUnsafe(
    "SELECT * FROM ValuationReport",
  )) as Record<string, unknown>[];
  const rawPrices = (await old.$queryRawUnsafe(
    "SELECT * FROM PriceSnapshot",
  )) as Record<string, unknown>[];
  const rawTimeline = (await old.$queryRawUnsafe(
    "SELECT * FROM TimelineEntry",
  )) as Record<string, unknown>[];
  const rawPeers = (await old.$queryRawUnsafe(
    "SELECT * FROM PeerValuation",
  )) as Record<string, unknown>[];
  const rawHist = (await old.$queryRawUnsafe(
    "SELECT * FROM HistoricalValuation",
  )) as Record<string, unknown>[];
  const rawValids = (await old.$queryRawUnsafe(
    "SELECT * FROM ValidationResult",
  )) as Record<string, unknown>[];
  await old.$disconnect();

  console.log(
    `旧库读取：Company=${rawCompanies.length} Assumption=${rawAssumptions.length} ValuationReport=${rawReports.length} PriceSnapshot=${rawPrices.length} TimelineEntry=${rawTimeline.length} PeerValuation=${rawPeers.length} HistoricalValuation=${rawHist.length} ValidationResult=${rawValids.length}`,
  );

  // —— 2. 写基准库（Company 基准字段）——
  process.env.BASELINE_DATABASE_URL = BASE_DB;
  const base = new BaseClient();
  const baseKeys = [
    "id", "name", "ticker", "currentPrice", "shares", "marketCap",
    "cash", "debt", "netCashAdj", "netCash", "e0", "revenue", "bookValue",
    "cfo", "capex", "da", "industry", "fxRate", "kd", "taxRate",
    "quoteUpdatedAt", "financialUpdatedAt", "createdAt", "updatedAt",
  ];
  for (const row of rawCompanies) {
    await base.company.create({
      data: pick(row, baseKeys, [
        "quoteUpdatedAt", "financialUpdatedAt", "createdAt", "updatedAt",
      ]) as never,
    });
  }
  await base.$disconnect();
  console.log(`基准库写入 Company=${rawCompanies.length}`);

  // —— 3. 写用户库 ——
  process.env.DATABASE_URL = USER_DB;
  const user = new PrismaClient();

  // 3.1 CompanySnapshot：由旧 Company 快照字段生成
  const snapKeys = [
    "id", "quadrant", "diagnosis", "targetPrice", "upside", "originalUpside",
    "impliedKe", "forwardKe", "wacc", "terminalProfitY20", "terminalFcfE3",
    "impliedL", "impliedLE3", "impliedCagr", "terminalProfitEst", "transitionG",
    "lastEvalDate",
  ];
  for (const row of rawCompanies) {
    await user.companySnapshot.create({
      data: {
        ...(pick(row, snapKeys, ["lastEvalDate"]) as Record<
          string,
          unknown
        >),
        companyId: row.id as string,
        createdAt: new Date(row.createdAt as string),
        updatedAt: new Date(row.updatedAt as string),
      } as never,
    });
  }
  console.log(`用户库写入 CompanySnapshot=${rawCompanies.length}`);

  // 3.2 Assumption
  const assumptionKeys = [
    "id", "companyId", "baseFcf", "g1", "g2", "g3", "perpetualG", "ke", "wacc",
    "payoutRate1", "payoutRate2", "e1", "e2", "e3", "reverseR", "exitPe",
    "transitionG", "terminalProfitEst", "crpName", "crpBps", "createdAt", "updatedAt",
  ];
  for (const row of rawAssumptions) {
    await user.assumption.create({
      data: pick(row, assumptionKeys, [
        "createdAt", "updatedAt",
      ]) as never,
    });
  }
  console.log(`用户库写入 Assumption=${rawAssumptions.length}`);

  // 3.3 ValuationReport
  const reportKeys = [
    "id", "companyId", "targetPrice", "upside", "originalUpside",
    "dcfEntityValue", "impliedL", "impliedLE3", "impliedKe", "forwardKe", "wacc",
    "terminalProfitY20", "terminalFcfE3", "impliedCagr",
    "mcP5", "mcP25", "mcMedian", "mcP75", "mcP95", "mcSamples",
    "sensitivityMatrix", "snapshot", "createdAt",
  ];
  for (const row of rawReports) {
    await user.valuationReport.create({
      data: pick(row, reportKeys, ["createdAt"], [
        "sensitivityMatrix", "snapshot",
      ]) as never,
    });
  }
  console.log(`用户库写入 ValuationReport=${rawReports.length}`);

  // 3.4 ValidationResult（依赖 ValuationReport 已建）
  const validKeys = [
    "id", "reportId", "companyId", "absoluteValue", "peValue", "pbValue",
    "psValue", "relativeValue", "currentPe", "currentPb", "currentPs",
    "industryPeMean", "industryPeMedian", "industryPbMean", "industryPsMean",
    "pePercentile", "pbPercentile", "psPercentile", "premiumDiscount",
    "diffRate", "conclusion", "aiAttribution", "sensitivityHeatmap", "createdAt",
  ];
  for (const row of rawValids) {
    await user.validationResult.create({
      data: pick(row, validKeys, ["createdAt"], [
        "sensitivityHeatmap",
      ]) as never,
    });
  }
  console.log(`用户库写入 ValidationResult=${rawValids.length}`);

  // 3.5 PriceSnapshot
  const priceKeys = [
    "id", "ticker", "date", "close", "volume", "companyId",
  ];
  for (const row of rawPrices) {
    await user.priceSnapshot.create({
      data: pick(row, priceKeys, ["date"]) as never,
    });
  }
  console.log(`用户库写入 PriceSnapshot=${rawPrices.length}`);

  // 3.6 TimelineEntry
  const timelineKeys = [
    "id", "companyId", "date", "content", "tags", "createdAt",
  ];
  for (const row of rawTimeline) {
    await user.timelineEntry.create({
      data: pick(row, timelineKeys, ["date", "createdAt"]) as never,
    });
  }
  console.log(`用户库写入 TimelineEntry=${rawTimeline.length}`);

  // 3.7 PeerValuation
  const peerKeys = [
    "id", "companyId", "peerTicker", "peerName", "marketCap", "e0", "revenue",
    "bookValue", "pe", "pb", "ps", "evEbitda", "fetchedAt",
  ];
  for (const row of rawPeers) {
    await user.peerValuation.create({
      data: pick(row, peerKeys, ["fetchedAt"]) as never,
    });
  }
  console.log(`用户库写入 PeerValuation=${rawPeers.length}`);

  // 3.8 HistoricalValuation
  const histKeys = ["id", "companyId", "year", "pe", "pb", "ps"];
  for (const row of rawHist) {
    await user.historicalValuation.create({
      data: pick(row, histKeys, []) as never,
    });
  }
  console.log(`用户库写入 HistoricalValuation=${rawHist.length}`);

  await user.$disconnect();
  console.log("✅ 迁移完成");
}

main().catch((e) => {
  console.error("❌ 迁移失败：", e);
  process.exit(1);
});
