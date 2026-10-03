/**
 * 初始股同步脚本：baseline.db（基准/种子库）→ user.db（用户库）Company 表
 * 将基准库的公司档案复制为用户库的"初始股"，保留原 id（companyId 引用一致性）。
 * 幂等安全：user 库已存在同 id 或同 ticker 的公司一律跳过，绝不覆盖用户已修改/新增的数据。
 * 用法：npx tsx scripts/sync-initial-companies.ts
 */
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaClient as BaseClient } from "../src/generated/prisma-base/client";

// 基于脚本位置动态解析项目根目录（兼容本地与服务器任意部署位置）
const ROOT = path.resolve(__dirname, "..");
const dbUrl = (...segments: string[]) =>
  `file:${path.join(ROOT, ...segments).replace(/\\/g, "/")}`;
const USER_DB = dbUrl("prisma", "user.db");
const BASE_DB = dbUrl("prisma", "baseline.db");

const prisma = new PrismaClient({ datasources: { db: { url: USER_DB } } });
const prismaBase = new BaseClient({ datasources: { db: { url: BASE_DB } } });

/** 从基准行中抽取档案字段（与 user.db Company 模型一一对应） */
function pickCompanyFields(row: Record<string, unknown>) {
  return {
    name: row.name as string,
    ticker: row.ticker as string,
    currentPrice: row.currentPrice as number,
    shares: row.shares as number,
    marketCap: row.marketCap as number,
    cash: row.cash as number,
    debt: row.debt as number,
    netCashAdj: row.netCashAdj as number,
    netCash: row.netCash as number,
    e0: row.e0 as number,
    revenue: row.revenue as number,
    bookValue: row.bookValue as number,
    cfo: row.cfo as number,
    capex: row.capex as number,
    da: row.da as number,
    industry: row.industry as string,
    fxRate: row.fxRate as number,
    kd: row.kd as number,
    taxRate: row.taxRate as number,
    quoteUpdatedAt: row.quoteUpdatedAt as Date | null,
    financialUpdatedAt: row.financialUpdatedAt as Date | null,
  };
}

async function main() {
  const baseCompanies = await prismaBase.company.findMany();
  let created = 0;
  let skipped = 0;

  for (const b of baseCompanies) {
    // 1. 同 id 已存在（此前同步过且未被删）→ 保留现状，跳过
    const byId = await prisma.company.findUnique({ where: { id: b.id } }).catch(() => null);
    if (byId) {
      skipped++;
      continue;
    }
    // 2. 同 ticker 已存在（用户手动新增过相同代码）→ 保留用户数据，跳过
    const byTicker = await prisma.company.findUnique({ where: { ticker: b.ticker } }).catch(() => null);
    if (byTicker) {
      skipped++;
      continue;
    }
    // 3. 新公司 → 原样复制（保留 id）
    await prisma.company.create({
      data: { id: b.id, ...pickCompanyFields(b) },
    });
    created++;
  }

  console.log(
    `初始股同步完成：基准公司 ${baseCompanies.length} 家；写入用户库 ${created} 家，跳过 ${skipped} 家（已存在，未覆盖用户数据）。`,
  );
  await prisma.$disconnect();
  await prismaBase.$disconnect();
}

main().catch(async (e) => {
  console.error("❌ 同步失败：", e.message ?? e);
  await prisma.$disconnect();
  await prismaBase.$disconnect();
  process.exit(1);
});
