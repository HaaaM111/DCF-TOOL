/**
 * GET /api/companies/[id]/prices
 * 获取标的的历史行情（用于双轴趋势图）
 * 优先读数据库 PriceSnapshot；覆盖不足时补充不复权日线。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { idSchema } from "@/lib/agent/schemas";
import { getOperatingHistory } from "@/lib/operating-model-store";
import { resolvePriceHistory } from "@/lib/data-source";
import { mainlandCloseWindow } from "@/lib/peer-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const id = req.nextUrl.pathname.split("/")[3];
  if (!idSchema.safeParse(id).success) return jsonError("无效id", 422);
  const company = await prisma.company.findUnique({
    where: { id },
    select: { ticker: true },
  });
  if (!company) return jsonError("标的不存在", 404, "NOT_FOUND");

  // 读取最近 180 天行情
  const closeOffset = /\.HK$/i.test(company.ticker) ? 3_600_000 : 0;
  const { end } = mainlandCloseWindow(new Date(Date.now() - closeOffset));
  const since = new Date(Date.parse(end) - 180 * 86_400_000);
  const start = since.toISOString().slice(0, 10);

  const [snapshots, history] = await Promise.all([
    prisma.priceSnapshot.findMany({ where: { ticker: company.ticker, date: { gte: since } }, orderBy: { date: "asc" } }),
    getOperatingHistory(id),
  ]);

  const savedPrices = snapshots.map((s) => ({
    date: s.date.toISOString().slice(0, 10),
    close: s.close,
    volume: s.volume,
  })).filter((row) => row.date <= end && Number.isFinite(row.close) && row.close > 0);
  const latest = savedPrices.at(-1)?.date;
  const needsHistory = savedPrices.length < 60 || !latest || Date.parse(end) - Date.parse(latest) > 7 * 86_400_000;
  const fetched = needsHistory ? await resolvePriceHistory(company.ticker, start, end).catch(() => null) : null;
  const prices = [...new Map([...savedPrices, ...(fetched?.source !== "mock" ? fetched?.data ?? [] : [])]
    .map((row) => [row.date, row])).values()].sort((a, b) => a.date.localeCompare(b.date));

  const currency = /\.(SH|SZ|BJ)$/i.test(company.ticker) ? "CNY" : /\.HK$/i.test(company.ticker) ? "HKD" : null;
  const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
  const valuation = history.map((item) => ({
    date: localDate.format(new Date(item.publishedAt)),
    targetPrice: !item.retrospective && item.currency === currency ? item.price : null,
  })).reverse();
  return jsonOk({ prices, valuation, currency, source: fetched?.source !== "mock" && fetched?.data.length ? fetched.source : prices.length ? "saved" : null });
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
