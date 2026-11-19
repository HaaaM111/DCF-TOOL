/**
 * 一次性数据修复脚本（合并历史标的 + 修正货币资金 + 重算估值）
 * ------------------------------------------------------------------
 * 背景：
 *   1) 合并后数据库里同时存在 userId=null 的历史标的与当前账号下的同名标的，
 *      首页四象限出现重复点、公告/假设/快照挂在不同的 companyId 上；
 *   2) 旧版 ifind-client / eastmoney-client 把「货币资金」写死为 0，
 *      导致净现金被算成「-有息负债」，DCF 目标价变成负数或接近 0。
 *
 * 用法（项目根目录）：
 *   tsx scripts/fix-valuation-data.ts          # 干跑，只打印计划
 *   tsx scripts/fix-valuation-data.ts --apply  # 实际写入
 *
 * 执行前请先备份 prisma/user.db。
 */
import { prisma } from "@/lib/prisma";
import { calcDcf, classifyQuadrant, diagnoseNarrative } from "@/lib/dcf";
import { fetchFinancials, hasIfindCredentials } from "@/lib/ifind-client";
import { fetchEastCash, isEastMoneyEnabled } from "@/lib/eastmoney-client";
import type { CompanyBasics, DcfAssumptions } from "@/types/dcf";

const APPLY = process.argv.includes("--apply");

function log(...args: unknown[]) {
  console.log(APPLY ? "[apply]" : "[dry-run]", ...args);
}

async function mergeLegacyCompanies(adminId: string) {
  const legacy = await prisma.company.findMany({ where: { userId: null } });
  log(`历史标的（userId 为空）：${legacy.length} 条`);

  for (const old of legacy) {
    const twin = await prisma.company.findFirst({
      where: { userId: adminId, ticker: old.ticker, id: { not: old.id } },
    });

    if (!twin) {
      log(`认领 ${old.name} ${old.ticker} → 归入当前账号`);
      if (APPLY) {
        await prisma.company.update({ where: { id: old.id }, data: { userId: adminId } });
        await prisma.priceSnapshot.updateMany({
          where: { companyId: old.id },
          data: { companyId: old.id },
        });
      }
      continue;
    }

    log(`合并重复 ${old.name} ${old.ticker}：${old.id} → ${twin.id}`);

    const oldAssumption = await prisma.assumption.findUnique({ where: { companyId: old.id } });
    const twinAssumption = await prisma.assumption.findUnique({ where: { companyId: twin.id } });
    const oldSnapshot = await prisma.companySnapshot.findUnique({ where: { companyId: old.id } });
    const twinSnapshot = await prisma.companySnapshot.findUnique({ where: { companyId: twin.id } });

    if (oldAssumption && !twinAssumption) log("  · 迁移估值假设");
    if (oldSnapshot && !twinSnapshot) log("  · 迁移估值快照");

    const oldAnnouncements = await prisma.announcement.findMany({ where: { companyId: old.id } });
    let moved = 0;
    let dropped = 0;
    for (const a of oldAnnouncements) {
      const dup = await prisma.announcement.findFirst({
        where: { companyId: twin.id, source: a.source, code: a.code },
      });
      if (dup) dropped += 1;
      else moved += 1;
    }
    log(`  · 公告 ${oldAnnouncements.length} 条：迁移 ${moved}，重复丢弃 ${dropped}`);

    if (!APPLY) continue;

    if (oldAssumption && !twinAssumption) {
      await prisma.assumption.update({ where: { companyId: old.id }, data: { companyId: twin.id } });
    } else if (oldAssumption) {
      await prisma.assumption.delete({ where: { companyId: old.id } });
    }

    if (oldSnapshot && !twinSnapshot) {
      await prisma.companySnapshot.update({ where: { companyId: old.id }, data: { companyId: twin.id } });
    } else if (oldSnapshot) {
      await prisma.companySnapshot.delete({ where: { companyId: old.id } });
    }

    for (const a of oldAnnouncements) {
      const dup = await prisma.announcement.findFirst({
        where: { companyId: twin.id, source: a.source, code: a.code },
      });
      if (dup) await prisma.announcement.delete({ where: { id: a.id } });
      else await prisma.announcement.update({ where: { id: a.id }, data: { companyId: twin.id } });
    }

    await prisma.valuationReport.updateMany({ where: { companyId: old.id }, data: { companyId: twin.id } });
    await prisma.validationResult.updateMany({ where: { companyId: old.id }, data: { companyId: twin.id } });
    await prisma.priceSnapshot.updateMany({ where: { companyId: old.id }, data: { companyId: twin.id } });
    await prisma.timelineEntry.updateMany({ where: { companyId: old.id }, data: { companyId: twin.id } });
    await prisma.historicalValuation.updateMany({ where: { companyId: old.id }, data: { companyId: twin.id } });
    await prisma.peerValuation.updateMany({ where: { companyId: old.id }, data: { companyId: twin.id } });
    await prisma.company.delete({ where: { id: old.id } });
  }
}

/** 与新增标的页一致的默认假设 */
function defaultAssumptions(company: { cfo: number; capex: number; e0: number }) {
  const baseFcf = Number((company.cfo - company.capex).toFixed(2));
  return {
    baseFcf,
    g1: 0.04,
    g2: 0.025,
    g3: 0.016,
    perpetualG: 0.012,
    ke: 0.12,
    payoutRate1: 0.5,
    payoutRate2: 0.7,
    e1: Number((company.e0 * 1.05).toFixed(2)),
    e2: Number((company.e0 * 1.1).toFixed(2)),
    e3: Number((company.e0 * 1.16).toFixed(2)),
    reverseR: 0.1,
    exitPe: 7,
    transitionG: 0.05,
    terminalProfitEst: 0,
    crpName: "",
    crpBps: 0,
  };
}

async function refreshCash(ticker: string): Promise<number | null> {
  try {
    if (hasIfindCredentials()) {
      const f = await fetchFinancials(ticker);
      if (f.cash > 0) return f.cash;
    }
  } catch {
    /* 落到东财 */
  }
  if (isEastMoneyEnabled()) {
    try {
      return await fetchEastCash(ticker);
    } catch {
      return null;
    }
  }
  return null;
}

async function recomputeAll() {
  const companies = await prisma.company.findMany({
    where: { userId: { not: null } },
    orderBy: { name: "asc" },
  });

  for (const company of companies) {
    let assumption = await prisma.assumption.findUnique({ where: { companyId: company.id } });
    if (!assumption) {
      const seed = defaultAssumptions(company);
      log(`补齐默认假设：${company.name} ${company.ticker} baseFcf=${seed.baseFcf}`);
      if (APPLY) {
        assumption = await prisma.assumption.create({ data: { companyId: company.id, ...seed } });
      } else {
        continue;
      }
    }

    // 1) 修正货币资金与净现金
    const cash = await refreshCash(company.ticker);
    if (cash === null) {
      log(`✗ ${company.name} 货币资金拉取失败，保留 cash=${company.cash}`);
    } else if (Math.abs(cash - company.cash) > 1e-6) {
      const netCash = Number((cash - company.debt + company.netCashAdj).toFixed(2));
      log(`货币资金 ${company.name}: ${company.cash} → ${cash} 亿；净现金 ${company.netCash} → ${netCash} 亿`);
      if (APPLY) {
        await prisma.company.update({ where: { id: company.id }, data: { cash, netCash } });
      }
      company.cash = cash;
      company.netCash = netCash;
    }

    // 2) 用修正后的净现金重算 DCF
    const basics: CompanyBasics = {
      currentPrice: company.currentPrice,
      shares: company.shares,
      netCash: company.netCash,
      e0: company.e0,
    };
    let output;
    try {
      output = calcDcf(assumption as unknown as DcfAssumptions, basics);
    } catch (e) {
      log(`✗ ${company.name} 重算失败：${e instanceof Error ? e.message : e}`);
      continue;
    }

    const snapshot = {
      targetPrice: output.forward.adjustedTargetPrice,
      upside: output.forward.adjustedUpside,
      originalUpside: output.forward.originalUpside,
      impliedKe: output.reverse.impliedKe,
      forwardKe: assumption.ke,
      wacc: output.forward.wacc,
      terminalProfitY20: output.forward.fcfY20,
      terminalFcfE3: assumption.e3 ? output.forward.fcfY20 / assumption.e3 : 0,
      impliedL: output.reverse.l,
      impliedLE3: output.reverse.lE3,
      impliedCagr: output.reverse.impliedCagr,
      terminalProfitEst: assumption.terminalProfitEst,
      transitionG: assumption.transitionG,
      quadrant: classifyQuadrant(output.reverse, assumption as unknown as DcfAssumptions),
      diagnosis: diagnoseNarrative(output.reverse, output.gordon, basics),
      lastEvalDate: new Date(),
    };

    log(
      `重算 ${company.name} ${company.ticker}: 目标价 ${snapshot.targetPrice.toFixed(2)} 元，空间 ${snapshot.upside.toFixed(1)}%，${snapshot.quadrant}`,
    );

    if (APPLY) {
      await prisma.companySnapshot.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id, ...snapshot },
        update: snapshot,
      });
      await prisma.valuationReport.create({
        data: {
          companyId: company.id,
          targetPrice: snapshot.targetPrice,
          upside: snapshot.upside,
          originalUpside: snapshot.originalUpside,
          dcfEntityValue: output.forward.originalEv,
          impliedL: snapshot.impliedL,
          impliedLE3: snapshot.impliedLE3,
          impliedKe: snapshot.impliedKe,
          forwardKe: snapshot.forwardKe,
          wacc: snapshot.wacc,
          terminalProfitY20: snapshot.terminalProfitY20,
          terminalFcfE3: snapshot.terminalFcfE3,
          impliedCagr: snapshot.impliedCagr,
          sensitivityMatrix: output.sensitivity as unknown as object,
          snapshot: { assumptions: assumption, output } as unknown as object,
        },
      });
    }
  }
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("未找到管理员账号，终止");
  log(`账号：${admin.email} (${admin.id})`);
  await mergeLegacyCompanies(admin.id);
  await recomputeAll();
  const remaining = await prisma.company.count();
  log(`剩余标的 ${remaining} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
