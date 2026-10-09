/**
 * 基准库维护脚本（唯一可写 baseline.db 的入口）
 * 用法（在项目根目录）：
 *   npx tsx scripts/manage-baseline.ts list
 *   npx tsx scripts/manage-baseline.ts add <company.json>
 *   npx tsx scripts/manage-baseline.ts import <export.json>
 *   npx tsx scripts/manage-baseline.ts update <id|ticker> <company.json>
 *   npx tsx scripts/manage-baseline.ts delete <id|ticker>
 *   npx tsx scripts/manage-baseline.ts sync-market [--mock]
 *
 * company.json 格式与旧 POST /api/companies 一致：{ "company": {...}, "assumptions": {...} }
 * export.json 由 GET /api/export 生成：[{ company: {...}, assumptions: {...} }]
 *
 * 脚本在写操作期间临时解除 baseline.db 的文件只读属性，完成后恢复。
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaClient as BaseClient } from "../src/generated/prisma-base/client";
import {
  calcDcf,
  classifyQuadrant,
  diagnoseNarrative,
} from "../src/lib/dcf";
import {
  assumptionsSchema,
  companySchema,
  importSchema,
} from "../src/lib/validation";

// 基于脚本位置动态解析项目根目录（兼容本地与服务器任意部署位置）
const ROOT = path.resolve(__dirname, "..");
const dbPath = (...segments: string[]) =>
  path.join(ROOT, ...segments).replace(/\\/g, "/");
const BASE_FILE = dbPath("prisma", "baseline.db");
const USER_FILE = dbPath("prisma", "user.db");

// 手动加载 .env.local（iFinD refresh_token 等），不依赖 dotenv 包
function loadEnvLocal() {
  try {
    const text = fs.readFileSync(dbPath(".env.local"), "utf-8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env.local 不存在则跳过
  }
}
loadEnvLocal();

function chmodWritable() {
  try {
    fs.chmodSync(BASE_FILE, 0o666);
  } catch {}
}
function chmodReadonly() {
  try {
    fs.chmodSync(BASE_FILE, 0o444);
  } catch {}
}

function baseClient(): BaseClient {
  process.env.BASELINE_DATABASE_URL = `file:${BASE_FILE}`; // 可写连接（无 mode=ro）
  return new BaseClient();
}
function userClient(): PrismaClient {
  process.env.DATABASE_URL = `file:${USER_FILE}`;
  return new PrismaClient();
}

/** 用 ticker 或 id 查找基准公司 */
async function resolveCompany(
  base: BaseClient,
  key: string,
): Promise<{ id: string; ticker: string } | null> {
  const byId = await base.company.findUnique({ where: { id: key } });
  if (byId) return byId;
  const byTicker = await base.company.findUnique({ where: { ticker: key } });
  return byTicker;
}

async function listCompanies() {
  const base = baseClient();
  const companies = await base.company.findMany({
    orderBy: { ticker: "asc" },
    select: {
      id: true,
      name: true,
      ticker: true,
      currentPrice: true,
      industry: true,
      updatedAt: true,
    },
  });
  console.table(companies.map((c) => ({ ...c })));
  await base.$disconnect();
}

/** 单条新增：{ company, assumptions? }，写基准库 + 用户库假设/快照 */
async function addCompany(jsonPath: string) {
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const cParsed = companySchema.safeParse(raw.company);
  if (!cParsed.success) {
    console.error("company 校验失败：", cParsed.error.issues.map((i) => i.message));
    process.exit(1);
  }
  const c = cParsed.data;

  let snap: Record<string, unknown> = {};
  let aParsed = assumptionsSchema.safeParse(raw.assumptions);
  if (aParsed.success) {
    const a = aParsed.data;
    const output = calcDcf(a, {
      currentPrice: c.currentPrice,
      shares: c.shares,
      netCash: c.netCash,
      e0: c.e0,
    });
    snap = {
      targetPrice: output.forward.adjustedTargetPrice,
      upside: output.forward.adjustedUpside,
      originalUpside: output.forward.originalUpside,
      impliedKe: output.reverse.impliedKe,
      forwardKe: a.ke,
      wacc: output.forward.wacc,
      terminalProfitY20: output.forward.fcfY20,
      terminalFcfE3: a.e3 ? output.forward.fcfY20 / a.e3 : 0,
      impliedL: output.reverse.l,
      impliedLE3: output.reverse.lE3,
      impliedCagr: output.reverse.impliedCagr,
      terminalProfitEst: a.terminalProfitEst,
      transitionG: a.transitionG,
      quadrant: classifyQuadrant(output.reverse, a),
      diagnosis: diagnoseNarrative(output.reverse, output.gordon, {
        currentPrice: c.currentPrice,
        shares: c.shares,
        netCash: c.netCash,
        e0: c.e0,
      }),
      lastEvalDate: new Date(),
    };
  }

  await withWritable(async () => {
    const base = baseClient();
    const user = userClient();
    try {
      const dup = await base.company.findUnique({ where: { ticker: c.ticker } });
      if (dup) {
        console.error(`已存在同 ticker 公司：${c.ticker}，跳过`);
        process.exit(1);
      }
      const company = await base.company.create({
        data: {
          name: c.name,
          ticker: c.ticker,
          currentPrice: c.currentPrice,
          shares: c.shares,
          marketCap: c.marketCap || c.currentPrice * c.shares,
          cash: c.cash,
          debt: c.debt,
          netCashAdj: c.netCashAdj,
          netCash: c.netCash,
          e0: c.e0,
          revenue: c.revenue,
          bookValue: c.bookValue,
          cfo: c.cfo,
          capex: c.capex,
          da: c.da,
          industry: c.industry,
          fxRate: c.fxRate,
          kd: c.kd,
          taxRate: c.taxRate,
        },
      });
      if (aParsed.success) {
        await user.assumption.create({
          data: { companyId: company.id, ...aParsed.data },
        });
        await user.companySnapshot.create({
          data: { companyId: company.id, ...snap },
        });
      }
      console.log(`✅ 新增 ${company.name} (${company.ticker}) id=${company.id}`);
    } finally {
      await base.$disconnect();
      await user.$disconnect();
    }
  });
}

/** 批量导入：export.json（GET /api/export 产物） */
async function importCompanies(jsonPath: string) {
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const parsed = importSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      "数据格式校验失败：",
      parsed.error.issues
        .slice(0, 5)
        .map((i) => `[${i.path.join(".")}] ${i.message}`)
        .join("；"),
    );
    process.exit(1);
  }

  let created = 0;
  let skipped = 0;
  await withWritable(async () => {
    const base = baseClient();
    const user = userClient();
    try {
      for (const item of parsed.data) {
        const dup = await base.company.findUnique({
          where: { ticker: item.company.ticker },
        });
        if (dup) {
          skipped++;
          continue;
        }
        const c = item.company;
        let snap: Record<string, unknown> = {};
        let aParsed = assumptionsSchema.safeParse(item.assumptions);
        if (aParsed.success) {
          const a = aParsed.data;
          const output = calcDcf(a, {
            currentPrice: c.currentPrice,
            shares: c.shares,
            netCash: c.netCash,
            e0: c.e0,
          });
          snap = {
            targetPrice: output.forward.adjustedTargetPrice,
            upside: output.forward.adjustedUpside,
            originalUpside: output.forward.originalUpside,
            impliedKe: output.reverse.impliedKe,
            forwardKe: a.ke,
            wacc: output.forward.wacc,
            terminalProfitY20: output.forward.fcfY20,
            terminalFcfE3: a.e3 ? output.forward.fcfY20 / a.e3 : 0,
            impliedL: output.reverse.l,
            impliedLE3: output.reverse.lE3,
            impliedCagr: output.reverse.impliedCagr,
            terminalProfitEst: a.terminalProfitEst,
            transitionG: a.transitionG,
            quadrant: classifyQuadrant(output.reverse, a),
            diagnosis: diagnoseNarrative(output.reverse, output.gordon, {
              currentPrice: c.currentPrice,
              shares: c.shares,
              netCash: c.netCash,
              e0: c.e0,
            }),
            lastEvalDate: new Date(),
          };
        }
        const company = await base.company.create({
          data: {
            name: c.name,
            ticker: c.ticker,
            currentPrice: c.currentPrice,
            shares: c.shares,
            marketCap: c.marketCap || c.currentPrice * c.shares,
            cash: c.cash,
            debt: c.debt,
            netCashAdj: c.netCashAdj,
            netCash: c.netCash,
            e0: c.e0,
            revenue: c.revenue,
            bookValue: c.bookValue,
            cfo: c.cfo,
            capex: c.capex,
            da: c.da,
            industry: c.industry,
            fxRate: c.fxRate,
            kd: c.kd,
            taxRate: c.taxRate,
          },
        });
        if (aParsed.success) {
          await user.assumption.create({
            data: { companyId: company.id, ...aParsed.data },
          });
          await user.companySnapshot.create({
            data: { companyId: company.id, ...snap },
          });
        }
        created++;
      }
    } finally {
      await base.$disconnect();
      await user.$disconnect();
    }
  });
  console.log(`✅ 导入完成：新增 ${created}，跳过 ${skipped}`);
}

/** 更新基准字段：company.json 中 company 对象的字段（仅更新提供的字段） */
async function updateCompany(key: string, jsonPath: string) {
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const cParsed = companySchema.partial().safeParse(raw.company);
  if (!cParsed.success) {
    console.error("company 校验失败：", cParsed.error.issues.map((i) => i.message));
    process.exit(1);
  }

  await withWritable(async () => {
    const base = baseClient();
    const user = userClient();
    try {
      const target = await resolveCompany(base, key);
      if (!target) {
        console.error(`未找到公司：${key}`);
        process.exit(1);
      }
      const c = cParsed.data;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(c)) {
        if (v !== undefined) patch[k] = v;
      }
      // marketCap 若随 price/shares 变化则联动
      if (patch.currentPrice !== undefined || patch.shares !== undefined) {
        const cur = await base.company.findUnique({ where: { id: target.id } });
        if (cur) {
          const price = (patch.currentPrice as number) ?? cur.currentPrice;
          const shares = (patch.shares as number) ?? cur.shares;
          patch.marketCap = (patch.marketCap as number) || price * shares;
        }
      }
      const updated = await base.company.update({
        where: { id: target.id },
        data: patch,
      });
      console.log(`✅ 已更新 ${updated.name} (${updated.ticker})`);
    } finally {
      await base.$disconnect();
      await user.$disconnect();
    }
  });
}

/** 删除公司：先清理用户数据，再删基准档案 */
async function deleteCompany(key: string) {
  await withWritable(async () => {
    const base = baseClient();
    const user = userClient();
    try {
      const target = await resolveCompany(base, key);
      if (!target) {
        console.error(`未找到公司：${key}`);
        process.exit(1);
      }
      const companyId = target.id;

      // 用户库：先删 ValidationResult（依赖 reportId），再删报告与其他
      const reportIds = (
        await user.valuationReport.findMany({
          where: { companyId },
          select: { id: true },
        })
      ).map((r) => r.id);
      await user.validationResult.deleteMany({
        where: { reportId: { in: reportIds } },
      });
      await user.valuationReport.deleteMany({ where: { companyId } });
      await user.assumption.deleteMany({ where: { companyId } });
      await user.companySnapshot.deleteMany({ where: { companyId } });
      await user.timelineEntry.deleteMany({ where: { companyId } });
      await user.priceSnapshot.updateMany({
        where: { companyId },
        data: { companyId: null },
      });
      await user.peerValuation.deleteMany({ where: { companyId } });
      await user.historicalValuation.deleteMany({ where: { companyId } });

      await base.company.delete({ where: { id: companyId } });
      console.log(`✅ 已删除 ${target.ticker}，并清理其全部用户数据`);
    } finally {
      await base.$disconnect();
      await user.$disconnect();
    }
  });
}

/** 行情同步：写 PriceSnapshot（用户库）+ 刷新 Company.currentPrice（基准库）
 *  数据链路：东财（免费）→ iFinD → mock；--mock 强制使用模拟数据 */
async function syncMarket(forceMock: boolean) {
  const { resolveQuote } = await import("../src/lib/data-source");
  const { getMockCompanyData } = await import("../src/lib/ifind-client");

  const useMock = forceMock;
  let total = 0;
  let success = 0;
  let failed = 0;
  const sourceCount = { eastmoney: 0, ifind: 0, mock: 0 };
  const errors: string[] = [];

  await withWritable(async () => {
    const base = baseClient();
    const user = userClient();
    try {
      const companies = await base.company.findMany({
        select: { id: true, ticker: true },
      });
      total = companies.length;

      for (const company of companies) {
        try {
          let close: number;
          if (useMock) {
            close = getMockCompanyData(company.ticker).currentPrice;
            sourceCount.mock++;
          } else {
            const { data, source } = await resolveQuote(company.ticker);
            close = data.close;
            sourceCount[source]++;
          }

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          await user.priceSnapshot.upsert({
            where: { ticker_date: { ticker: company.ticker, date: today } },
            update: { close, companyId: company.id },
            create: {
              ticker: company.ticker,
              date: today,
              close,
              volume: 0,
              companyId: company.id,
            },
          });

          await base.company.update({
            where: { id: company.id },
            data: { currentPrice: close, quoteUpdatedAt: new Date() },
          });

          success++;
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : "未知错误";
          errors.push(`${company.ticker}: ${msg}`);
        }
      }
    } finally {
      await base.$disconnect();
      await user.$disconnect();
    }
  });

  console.log(
    `行情同步完成：total=${total} success=${success} failed=${failed} mock=${useMock} ` +
      `来源：东财=${sourceCount.eastmoney} iFinD=${sourceCount.ifind} mock=${sourceCount.mock}`,
  );
  if (errors.length) console.error("错误明细：\n" + errors.join("\n"));
}

/** 写基准库的公共包装：临时解除文件只读，完成后恢复 */
async function withWritable<T>(fn: () => Promise<T>): Promise<T> {
  chmodWritable();
  try {
    return await fn();
  } finally {
    chmodReadonly();
  }
}

// —— 命令分发 ——
const [cmd, arg1, arg2] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case "list":
      await listCompanies();
      break;
    case "add":
      if (!arg1) {
        console.error("用法：manage-baseline.ts add <company.json>");
        process.exit(1);
      }
      await addCompany(arg1);
      break;
    case "import":
      if (!arg1) {
        console.error("用法：manage-baseline.ts import <export.json>");
        process.exit(1);
      }
      await importCompanies(arg1);
      break;
    case "update":
      if (!arg1 || !arg2) {
        console.error("用法：manage-baseline.ts update <id|ticker> <company.json>");
        process.exit(1);
      }
      await updateCompany(arg1, arg2);
      break;
    case "delete":
      if (!arg1) {
        console.error("用法：manage-baseline.ts delete <id|ticker>");
        process.exit(1);
      }
      await deleteCompany(arg1);
      break;
    case "sync-market":
      await syncMarket(arg1 === "--mock");
      break;
    default:
      console.log(
        [
          "基准库维护脚本（只读保护开启后，这是唯一可写入口）",
          "用法：",
          "  npx tsx scripts/manage-baseline.ts list",
          "  npx tsx scripts/manage-baseline.ts add <company.json>",
          "  npx tsx scripts/manage-baseline.ts import <export.json>",
          "  npx tsx scripts/manage-baseline.ts update <id|ticker> <company.json>",
          "  npx tsx scripts/manage-baseline.ts delete <id|ticker>",
          "  npx tsx scripts/manage-baseline.ts sync-market [--mock]",
        ].join("\n"),
      );
  }
}

main().catch((e) => {
  console.error("❌ 执行失败：", e);
  process.exit(1);
});
