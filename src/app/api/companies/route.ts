/**
 * GET  /api/companies  —— 获取全部标的（含假设与评估快照），供排行榜使用
 * POST /api/companies  —— 新增估值标的（写用户库：公司档案 + 假设 + 快照 + 报告留痕）
 */
import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getAllCompaniesMerged, getCompanyMerged } from "@/lib/dual-db";
import { assumptionsSchema, companySchema } from "@/lib/validation";
import {
  calcDcf,
  classifyQuadrant,
  diagnoseNarrative,
} from "@/lib/dcf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const companies = await getAllCompaniesMerged();
  return jsonOk({ companies });
}

export async function POST(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("请求体不是合法的 JSON", 400, "INVALID_JSON");
  }

  const { company: rawC, assumptions: rawA } = (body ?? {}) as Record<
    string,
    unknown
  >;

  const cParsed = companySchema.safeParse(rawC);
  if (!cParsed.success) {
    return jsonError(
      `公司数据校验失败：${cParsed.error.issues.map((i) => i.message).join("；")}`,
      422,
      "VALIDATION_ERROR",
    );
  }
  const c = cParsed.data;

  // 同代码去重：ticker 唯一，已存在则返回冲突
  const dup = await prisma.company.findUnique({ where: { ticker: c.ticker } });
  if (dup) {
    return jsonError(`该股票代码（${c.ticker}）已存在，请直接编辑现有标的`, 409, "DUPLICATE_TICKER");
  }

  // 创建公司档案（用户库）
  const created = await prisma.company.create({
    data: {
      name: c.name,
      ticker: c.ticker,
      currentPrice: c.currentPrice,
      shares: c.shares,
      marketCap: c.marketCap,
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

  const aParsed = assumptionsSchema.safeParse(rawA);
  if (aParsed.success) {
    const a = aParsed.data;
    const output = calcDcf(a, {
      currentPrice: c.currentPrice,
      shares: c.shares,
      netCash: c.netCash,
      e0: c.e0,
    });
    const snapshotFields = {
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

    await prisma.valuationReport.create({
      data: {
        companyId: created.id,
        targetPrice: output.forward.adjustedTargetPrice,
        upside: output.forward.adjustedUpside,
        originalUpside: output.forward.originalUpside,
        dcfEntityValue: output.forward.originalEv,
        impliedL: output.reverse.l,
        impliedLE3: output.reverse.lE3,
        impliedKe: output.reverse.impliedKe,
        forwardKe: a.ke,
        wacc: output.forward.wacc,
        terminalProfitY20: output.forward.fcfY20,
        terminalFcfE3: a.e3 ? output.forward.fcfY20 / a.e3 : 0,
        impliedCagr: output.reverse.impliedCagr,
        sensitivityMatrix: output.sensitivity as unknown as Prisma.InputJsonValue,
        snapshot: { assumptions: a, output } as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.assumption.create({
      data: { companyId: created.id, ...aParsed.data },
    });

    await prisma.companySnapshot.create({
      data: { companyId: created.id, ...snapshotFields },
    });
  }

  const company = await getCompanyMerged(created.id);
  return jsonOk({ company }, 201);
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
