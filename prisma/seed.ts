/**
 * 种子脚本：初始化示例公司（上汽集团、宇通客车、福耀玻璃）
 * 财务数据（现价、E0、CFO、Capex、D&A、总股本、有息负债）从 iFinD 实时拉取；
 * 估值假设（增速、Ke、退出倍数等）保留分析师设定值。
 * 若未配置 IFIND_REFRESH_TOKEN，则回退到硬编码 mock 财务数据。
 *
 * 双库结构：Company 写基准库（baseline.db，脚本运行期间临时解除只读属性），
 * 假设/快照/报告/行情写用户库（user.db）。
 * 运行：npx tsx prisma/seed.ts
 */
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaClient as BaseClient } from "../src/generated/prisma-base/client";
import { calcDcf, classifyQuadrant, diagnoseNarrative } from "../src/lib/dcf";
import { fetchCompanyData, hasIfindCredentials } from "../src/lib/ifind-client";

// 基于脚本位置动态解析项目根目录（兼容本地与服务器任意部署位置）
const ROOT = path.resolve(__dirname, "..");
const dbPath = (...segments: string[]) =>
  path.join(ROOT, ...segments).replace(/\\/g, "/");

// 加载 .env 与 .env.local（tsx 不会自动加载）
// 手动解析 .env.local 并强制覆盖，确保真实 token 覆盖 .env 中的空占位
process.loadEnvFile(path.join(ROOT, ".env"));
try {
  const content = fs.readFileSync(dbPath(".env.local"), "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* .env.local 不存在时忽略 */
}

const BASE_FILE = dbPath("prisma", "baseline.db");
const USER_FILE = dbPath("prisma", "user.db");

process.env.BASELINE_DATABASE_URL = `file:${BASE_FILE}`; // 可写连接
process.env.DATABASE_URL = `file:${USER_FILE}`;
const prisma = new PrismaClient();
const prismaBase = new BaseClient();

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

const samples = [
  {
    name: "上汽集团",
    ticker: "600104.SH",
    currentPrice: 10.2,
    shares: 116.5,
    cash: 1510.0,
    debt: 130.0,
    netCashAdj: 0,
    e0: 126.5,
    cfo: 320.0,
    capex: 110.0,
    da: 120.0,
    fxRate: 1,
    kd: 0.036,
    taxRate: 0.2,
    industry: "汽车整车",
    revenue: 7000,
    bookValue: 2800,
    assumptions: {
      baseFcf: 200.0,
      g1: 0.05,
      g2: 0.02,
      g3: 0.0,
      perpetualG: 0.012,
      ke: 0.1,
      payoutRate1: 0.5,
      payoutRate2: 0.7,
      e1: 130.0,
      e2: 138.0,
      e3: 145.0,
      reverseR: 0.1,
      exitPe: 7,
      transitionG: 0.012,
      terminalProfitEst: 166.5,
      crpName: "",
      crpBps: 0,
    },
  },
  {
    name: "宇通客车",
    ticker: "600066.SH",
    currentPrice: 14.5,
    shares: 22.1,
    cash: 150.0,
    debt: 30.0,
    netCashAdj: 0,
    e0: 15.0,
    cfo: 35.0,
    capex: 8.0,
    da: 9.0,
    fxRate: 1,
    kd: 0.036,
    taxRate: 0.2,
    industry: "汽车整车",
    revenue: 380,
    bookValue: 120,
    assumptions: {
      baseFcf: 25.0,
      g1: 0.08,
      g2: 0.04,
      g3: 0.02,
      perpetualG: 0.015,
      ke: 0.11,
      payoutRate1: 0.5,
      payoutRate2: 0.7,
      e1: 16.0,
      e2: 17.5,
      e3: 19.0,
      reverseR: 0.11,
      exitPe: 8,
      transitionG: 0.03,
      terminalProfitEst: 30.0,
      crpName: "",
      crpBps: 0,
    },
  },
  {
    name: "福耀玻璃",
    ticker: "600660.SH",
    currentPrice: 38.6,
    shares: 26.1,
    cash: 180.0,
    debt: 60.0,
    netCashAdj: 0,
    e0: 47.5,
    cfo: 85.0,
    capex: 35.0,
    da: 20.0,
    fxRate: 1,
    kd: 0.036,
    taxRate: 0.2,
    industry: "汽车零部件",
    revenue: 300,
    bookValue: 320,
    assumptions: {
      baseFcf: 50.0,
      g1: 0.06,
      g2: 0.04,
      g3: 0.02,
      perpetualG: 0.02,
      ke: 0.095,
      payoutRate1: 0.6,
      payoutRate2: 0.75,
      e1: 50.0,
      e2: 54.0,
      e3: 58.0,
      reverseR: 0.095,
      exitPe: 12,
      transitionG: 0.04,
      terminalProfitEst: 75.0,
      crpName: "",
      crpBps: 0,
    },
  },
];

/** 生成 180 天模拟历史行情 */
function genHistory(basePrice: number, seed: number, days = 180) {
  const bars: { date: Date; close: number; volume: number }[] = [];
  let price = basePrice * 0.85; // 从 85% 起步
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const r = Math.sin(seed + i * 0.3) * 0.015 + (Math.random() - 0.5) * 0.01;
    price = Math.max(1, price * (1 + r));
    bars.push({
      date: d,
      close: Number(price.toFixed(2)),
      volume: 5000000 + Math.abs(Math.sin(seed + i)) * 10000000,
    });
  }
  return bars;
}

async function main() {
  chmodWritable(); // 写基准库前解除只读
  try {
    const useReal = hasIfindCredentials();
    if (!useReal) {
      console.warn(
        "⚠️  未检测到 IFIND_REFRESH_TOKEN，将使用硬编码 mock 财务数据。",
      );
    }

    for (const s of samples) {
      // 从 iFinD 拉取真实财务数据，覆盖硬编码 mock
      let real = null;
      if (useReal) {
        try {
          real = await fetchCompanyData(s.ticker);
          console.log(`  ↳ ${s.ticker} 真实数据：现价 ¥${real.currentPrice}，E0=${real.e0}亿，CFO=${real.cfo}亿，Capex=${real.capex}亿`);
        } catch (e) {
          console.warn(`  ⚠️  ${s.ticker} iFinD 拉取失败，回退 mock：${(e as Error).message}`);
        }
      }

      // 合并真实数据（财务字段用真实值，分析师假设保留 seed 中的设定）
      const fin = real
        ? {
            ...s,
            currentPrice: real.currentPrice,
            shares: real.shares,
            debt: real.debt || s.debt,
            e0: real.e0 || s.e0,
            cfo: real.cfo || s.cfo,
            capex: real.capex || s.capex,
            da: real.da || s.da,
            cash: real.cash || s.cash,
            revenue: real.revenue || s.revenue,
            bookValue: real.bookValue || s.bookValue,
            assumptions: {
              ...s.assumptions,
              // 由真实 E0 推导未来三年利润预测
              e1: Number((real.e0 * 1.05).toFixed(2)),
              e2: Number((real.e0 * 1.1).toFixed(2)),
              e3: Number((real.e0 * 1.16).toFixed(2)),
              // 起点 FCF = 真实 CFO - Capex
              baseFcf: Number((real.cfo - real.capex).toFixed(2)),
            },
          }
        : s;

      const netCash = fin.cash - fin.debt + fin.netCashAdj;
      const output = calcDcf(fin.assumptions, {
        currentPrice: fin.currentPrice,
        shares: fin.shares,
        netCash,
        e0: fin.e0,
      });
      const quadrant = classifyQuadrant(output.reverse, fin.assumptions);
      const diagnosis = diagnoseNarrative(output.reverse, output.gordon, {
        currentPrice: fin.currentPrice,
        shares: fin.shares,
        netCash,
        e0: fin.e0,
      });

      const baseData = {
        name: fin.name,
        ticker: fin.ticker,
        currentPrice: fin.currentPrice,
        shares: fin.shares,
        marketCap: fin.currentPrice * fin.shares,
        cash: fin.cash,
        debt: fin.debt,
        netCashAdj: fin.netCashAdj,
        netCash,
        e0: fin.e0,
        revenue: fin.revenue,
        bookValue: fin.bookValue,
        cfo: fin.cfo,
        capex: fin.capex,
        da: fin.da,
        industry: fin.industry,
        fxRate: fin.fxRate,
        kd: fin.kd,
        taxRate: fin.taxRate,
      };

      const snapshotData = {
        quadrant,
        diagnosis,
        targetPrice: output.forward.adjustedTargetPrice,
        upside: output.forward.adjustedUpside,
        originalUpside: output.forward.originalUpside,
        impliedKe: output.reverse.impliedKe,
        forwardKe: fin.assumptions.ke,
        wacc: output.forward.wacc,
        terminalProfitY20: output.forward.fcfY20,
        terminalFcfE3: fin.assumptions.e3
          ? output.forward.fcfY20 / fin.assumptions.e3
          : 0,
        impliedL: output.reverse.l,
        impliedLE3: output.reverse.lE3,
        impliedCagr: output.reverse.impliedCagr,
        terminalProfitEst: fin.assumptions.terminalProfitEst,
        transitionG: fin.assumptions.transitionG,
        lastEvalDate: new Date(),
      };

      // 基准库：Company 档案
      const company = await prismaBase.company.upsert({
        where: { ticker: fin.ticker },
        update: baseData,
        create: baseData,
      });

      // 用户库：评估快照
      await prisma.companySnapshot.upsert({
        where: { companyId: company.id },
        update: snapshotData,
        create: { companyId: company.id, ...snapshotData },
      });

      // 用户库：写入假设
      await prisma.assumption.upsert({
        where: { companyId: company.id },
        update: { ...fin.assumptions },
        create: { companyId: company.id, ...fin.assumptions },
      });

      // 用户库：写入估值报告
      await prisma.valuationReport.create({
        data: {
          companyId: company.id,
          targetPrice: output.forward.adjustedTargetPrice,
          upside: output.forward.adjustedUpside,
          originalUpside: output.forward.originalUpside,
          dcfEntityValue: output.forward.originalEv,
          impliedL: output.reverse.l,
          impliedLE3: output.reverse.lE3,
          impliedKe: output.reverse.impliedKe,
          forwardKe: fin.assumptions.ke,
          wacc: output.forward.wacc,
          terminalProfitY20: output.forward.fcfY20,
          terminalFcfE3: fin.assumptions.e3
            ? output.forward.fcfY20 / fin.assumptions.e3
            : 0,
          impliedCagr: output.reverse.impliedCagr,
          snapshot: { assumptions: fin.assumptions, output } as any,
        },
      });

      // 用户库：写入历史行情
      const seed = Array.from(fin.ticker).reduce((a, c) => a + c.charCodeAt(0), 0);
      const bars = genHistory(fin.currentPrice, seed);
      for (const bar of bars) {
        await prisma.priceSnapshot.upsert({
          where: { ticker_date: { ticker: fin.ticker, date: bar.date } },
          update: { close: bar.close, volume: bar.volume },
          create: {
            ticker: fin.ticker,
            date: bar.date,
            close: bar.close,
            volume: bar.volume,
            companyId: company.id,
          },
        });
      }

      console.log(`✓ ${fin.name} (${fin.ticker}) 目标价 ¥${output.forward.adjustedTargetPrice.toFixed(2)}`);
    }
    console.log("种子数据写入完成");
  } finally {
    chmodReadonly(); // 恢复基准库只读
    await prisma.$disconnect();
    await prismaBase.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
