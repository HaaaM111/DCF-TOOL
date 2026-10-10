/**
 * GET /api/announcements —— 公告列表查询（含预期差信号）
 * 参数：companyId / category / page / pageSize，按 publishAt 倒序
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const sp = req.nextUrl.searchParams;
  const companyId = sp.get("companyId") ?? undefined;
  const category = sp.get("category") ?? undefined;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, parseInt(sp.get("pageSize") ?? "20", 10) || 20),
  );

  const where = {
    ...(companyId ? { companyId } : {}),
    ...(category ? { category } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.findMany({
      where,
      include: { signals: true },
      orderBy: { publishAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return jsonOk({ total, page, pageSize, items });
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
