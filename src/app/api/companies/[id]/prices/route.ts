import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { fetchEastPriceHistory } from "@/lib/eastmoney-client";
import { fetchTencentPriceHistory } from "@/lib/tencent-client";
import { prisma } from "@/lib/prisma";
import { companyAccessWhere } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;

  const id = req.nextUrl.pathname.split("/")[3];
  const company = await prisma.company.findFirst({ where: companyAccessWhere(req, id), select: { id: true, ticker: true } });
  if (!company) return jsonError("标的不存在", 404, "NOT_FOUND");

  const since = new Date();
  since.setDate(since.getDate() - 180);

  const [snapshots, reports] = await Promise.all([
    prisma.priceSnapshot.findMany({
      where: { ticker: company.ticker, date: { gte: since } },
      orderBy: { date: "asc" },
    }),
    prisma.valuationReport.findMany({
      where: { companyId: id, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, targetPrice: true },
    }),
  ]);

  let prices = snapshots.map((snapshot) => ({
    date: snapshot.date.toISOString().slice(0, 10),
    close: snapshot.close,
    volume: snapshot.volume,
  }));

  if (prices.length < 2) {
    const startDate = since.toISOString().slice(0, 10);
    const endDate = new Date().toISOString().slice(0, 10);
    try {
      prices = await fetchTencentPriceHistory(company.ticker, startDate, endDate);
    } catch (tencentError) {
      try {
        prices = await fetchEastPriceHistory(company.ticker, startDate, endDate);
      } catch (eastError) {
        console.error(
          `[prices] ${company.ticker} 历史行情补充失败:`,
          {
            tencent: tencentError instanceof Error ? tencentError.message : tencentError,
            eastmoney: eastError instanceof Error ? eastError.message : eastError,
          },
        );
      }
    }
  }

  const valuation = reports.map((report) => ({
    date: report.createdAt.toISOString().slice(0, 10),
    targetPrice: report.targetPrice,
  }));

  return jsonOk({ prices, valuation });
}

export async function OPTIONS(req: NextRequest) {
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
