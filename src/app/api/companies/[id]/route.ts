/**
 * GET    /api/companies/[id]  —— 单个标的详情（含假设、时间线、评估快照）
 * PUT    /api/companies/[id]  —— 更新模型假设并重算快照（写用户库；基准公司档案只读）
 * DELETE /api/companies/[id]  —— 已禁用：基准库只读，删除请使用 scripts/manage-baseline.ts
 */
import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma, prismaBase } from "@/lib/prisma";
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

export async function PUT(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const id = idParam(req);
  const base = await prismaBase.company.findUnique({ where: { id } });
  if (!base) return jsonError("标的不存在", 404, "NOT_FOUND");

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

  // 组装响应（基准公司 + 快照 + 假设 + 时间线）
  const company = await getCompanyMerged(id);
  return jsonOk({ company });
}

export async function DELETE(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const id = idParam(req);
  const base = await prismaBase.company.findUnique({ where: { id } });
  if (!base) return jsonError("标的不存在", 404, "NOT_FOUND");

  return jsonError(
    "基准数据只读：删除公司请使用管理脚本 scripts/manage-baseline.ts（npx tsx scripts/manage-baseline.ts delete <id|ticker>）",
    403,
    "BASELINE_READONLY",
  );
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
