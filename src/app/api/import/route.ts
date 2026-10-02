/**
 * POST /api/import —— 已禁用
 * 批量导入会写入基准公司档案；基准库只读，请使用管理脚本：
 *   npx tsx scripts/manage-baseline.ts import <file.json>
 * （导出文件可通过 GET /api/export 生成）
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  return jsonError(
    "基准数据只读：批量导入请使用管理脚本 scripts/manage-baseline.ts（npx tsx scripts/manage-baseline.ts import <file.json>）",
    403,
    "BASELINE_READONLY",
  );
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
