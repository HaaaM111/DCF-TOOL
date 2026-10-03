/**
 * GET    /api/companies/[id]  —— 单个标的详情（含假设、时间线、评估快照）
 * PUT    /api/companies/[id]  —— 更新公司档案 + 模型假设并重算快照（写用户库）
 * DELETE /api/companies/[id]  —— 删除标的（级联清理假设/快照/报告/时间线等，写用户库）
 */
import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getCompanyMerged } from "@/lib/dual-db";
import { assumptionsSchema, companySchema } from "@/lib/validation";
import {
  calcDcf,
  classifyQuadrant,
  diagnoseNarrative,
} from "@/lib/dcf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function idParam(req: NextRequest) {
  return req.nextUrl.pathname.split("/").pop() ?? "";
}

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const id = idParam(req);
  const company = await getCompanyMerged(id);
  if (!company) return jsonError("标的不存在", 404, "NOT_FOUND");
  return jsonOk({ company });
}

/** 公司档案字段（来自 companySchema 校验结果，写入 user.db Company） */
function companyFields(c: ReturnType<typeof companySchema.parse>) {
  return {
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
  };
}

export async function PUT(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const id = idParam(req);
  const existing = await prisma.company.findUnique({ where: { id } });
  if (!existing) return jsonError("标的不存在", 404, "NOT_FOUND");

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

  // 更新公司档案（用户库）
  await prisma.company.update({
    where: { id },
    data: companyFields(c),
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

    // 写入估值报告留痕（用户库）
    await prisma.valuationReport.create({
      data: {
        companyId: id,
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

    // 保存模型假设（用户库）
    await prisma.assumption.upsert({
      where: { companyId: id },
      create: { companyId: id, ...aParsed.data },
      update: { ...aParsed.data },
    });

    // 刷新评估快照（用户库）
    await prisma.companySnapshot.upsert({
      where: { companyId: id },
      create: { companyId: id, ...snapshotFields },
      update: { ...snapshotFields },
    });
  }

  // 组装响应（公司档案 + 快照 + 假设 + 时间线）
  const company = await getCompanyMerged(id);
  return jsonOk({ company });
}

export async function DELETE(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const id = idParam(req);
  const existing = await prisma.company.findUnique({ where: { id } });
  if (!existing) return jsonError("标的不存在", 404, "NOT_FOUND");

  // 级联清理关联数据（用户库各表无物理外键，需按引用关系手动删除）
  const reports = await prisma.valuationReport.findMany({
    where: { companyId: id },
    select: { id: true },
  });
  await prisma.$transaction([
    // 1. 估值验证结果（挂在估值报告下）
    prisma.validationResult.deleteMany({
      where: { reportId: { in: reports.map((r) => r.id) } },
    }),
    // 2. 估值报告留痕
    prisma.valuationReport.deleteMany({ where: { companyId: id } }),
    // 3. 模型假设
    prisma.assumption.deleteMany({ where: { companyId: id } }),
    // 4. 评估快照
    prisma.companySnapshot.deleteMany({ where: { companyId: id } }),
    // 5. 时间线笔记
    prisma.timelineEntry.deleteMany({ where: { companyId: id } }),
    // 6. 价格快照（companyId 可空，需一并清理）
    prisma.priceSnapshot.deleteMany({ where: { companyId: id } }),
    // 7. 同行对比
    prisma.peerValuation.deleteMany({ where: { companyId: id } }),
    // 8. 历史估值
    prisma.historicalValuation.deleteMany({ where: { companyId: id } }),
    // 9. 公司档案本身
    prisma.company.delete({ where: { id } }),
  ]);

  return jsonOk({ deleted: true });
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
