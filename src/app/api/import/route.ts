/**
 * POST /api/import —— 已禁用
 * 批量导入请使用管理脚本：npx tsx scripts/manage-baseline.ts import <file.json>
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
    "批量导入已停用，请手动执行：npx tsx scripts/manage-baseline.ts import <file.json>",
    403,
    "IMPORT_DISABLED",
  );
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
