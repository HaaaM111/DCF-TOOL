/**
 * 市场数据同步 —— 已迁移至管理脚本
 * 行情刷新会更新基准库 Company.currentPrice（基准只读），故 Web 接口停用，
 * 请使用：npx tsx scripts/manage-baseline.ts sync-market
 * 该脚本同时写入 PriceSnapshot（用户库）并刷新 Company.currentPrice（基准库）。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  return jsonError(
    "行情同步已迁移至管理脚本：npx tsx scripts/manage-baseline.ts sync-market",
    403,
    "BASELINE_READONLY",
  );
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
