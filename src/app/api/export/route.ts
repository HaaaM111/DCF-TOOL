/**
 * GET /api/export —— 导出全部标的（公司 + 假设 + 评估快照）为 JSON
 * 用于备份与跨设备迁移（可通过 scripts/manage-baseline.ts import 恢复到基准库）。
 */
import { NextRequest } from "next/server";
import { guardRequest } from "@/lib/api";
import { getAllCompaniesMerged } from "@/lib/dual-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const companies = await getAllCompaniesMerged();

  const payload = companies.map((c: Record<string, unknown>) => ({
    company: {
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
      cfo: c.cfo,
      capex: c.capex,
      da: c.da,
      fxRate: c.fxRate,
      kd: c.kd,
      taxRate: c.taxRate,
      quadrant: c.quadrant ?? "",
      diagnosis: c.diagnosis ?? "",
    },
    assumptions: (c.assumption as unknown) ?? undefined,
  }));

  const json = JSON.stringify(payload, null, 2);
  return new Response(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dcf-export-${Date.now()}.json"`,
    },
  });
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
