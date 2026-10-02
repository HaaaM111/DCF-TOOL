/**
 * GET  /api/companies  —— 获取全部标的（含假设与评估快照），供排行榜使用
 * POST /api/companies  —— 已禁用：基准库只读，新增标的请使用 scripts/manage-baseline.ts
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { getAllCompaniesMerged } from "@/lib/dual-db";

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

  return jsonError(
    "基准数据只读：新增公司请使用管理脚本 scripts/manage-baseline.ts（npx tsx scripts/manage-baseline.ts add）",
    403,
    "BASELINE_READONLY",
  );
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
