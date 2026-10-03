/**
 * 市场数据同步 —— 已迁移至管理脚本
 * 请使用：npx tsx scripts/manage-baseline.ts sync-market
 * 该脚本写入 PriceSnapshot（用户库）并刷新公司现价。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  return jsonError(
    "行情同步已停用，请手动执行：npx tsx scripts/manage-baseline.ts sync-market",
    403,
    "SYNC_DISABLED",
  );
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
