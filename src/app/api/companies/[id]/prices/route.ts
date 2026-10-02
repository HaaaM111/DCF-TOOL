/**
 * GET /api/companies/[id]/prices
 * 获取标的的历史行情（用于双轴趋势图）
 * 优先读数据库 PriceSnapshot；若不足则从 iFinD 补充。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma, prismaBase } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const id = req.nextUrl.pathname.split("/")[3];
  const company = await prismaBase.company.findUnique({
    where: { id },
    select: { ticker: true },
  });
  if (!company) return jsonError("标的不存在", 404, "NOT_FOUND");

  // 读取最近 180 天行情
  const since = new Date();
  since.setDate(since.getDate() - 180);

  const snapshots = await prisma.priceSnapshot.findMany({
    where: { ticker: company.ticker, date: { gte: since } },
    orderBy: { date: "asc" },
  });

  const prices = snapshots.map((s) => ({
    date: s.date.toISOString().slice(0, 10),
    close: s.close,
    volume: s.volume,
  }));

  return jsonOk({ prices });
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
