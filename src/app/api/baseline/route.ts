/**
 * GET /api/baseline —— 基准库公司档案（只读参考，供界面底部对照展示）
 * 仅返回档案字段；该接口只读，不提供任何写入能力。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prismaBase } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  try {
    const companies = await prismaBase.company.findMany({
      orderBy: { ticker: "asc" },
    });
    return jsonOk({ companies });
  } catch (err) {
    console.error("[baseline] 读取失败:", err);
    return jsonError("基准档案暂不可用", 500, "BASELINE_UNAVAILABLE");
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
