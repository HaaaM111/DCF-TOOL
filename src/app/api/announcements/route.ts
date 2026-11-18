import { NextRequest } from "next/server";
import { guardRequest, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;

  const sp = req.nextUrl.searchParams;
  const companyId = sp.get("companyId") ?? undefined;
  const category = sp.get("category") ?? undefined;
  const daysRaw = parseInt(sp.get("days") ?? "", 10);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : undefined;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, parseInt(sp.get("pageSize") ?? "20", 10) || 20),
  );

  const userId = getAuthenticatedUserId(req);
  const ownedCompanies = await prisma.company.findMany({ where: { userId }, select: { id: true } });
  const ownedIds = ownedCompanies.map((company) => company.id);
  if (companyId && !ownedIds.includes(companyId)) {
    return jsonOk({ total: 0, page, pageSize, items: [] });
  }
  const where = {
    companyId: companyId ?? { in: ownedIds },
    ...(category ? { category } : {}),
    ...(days ? { publishAt: { gte: new Date(Date.now() - days * 24 * 3600 * 1000) } } : {}),
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
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
