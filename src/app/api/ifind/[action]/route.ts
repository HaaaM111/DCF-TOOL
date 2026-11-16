import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  resolveQuote,
  resolveFinancials,
  resolveCompanyData,
  resolvePriceHistory,
  type HistoryBar,
} from "@/lib/data-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getTicker(req: NextRequest): string {
  return req.nextUrl.searchParams.get("ticker")?.trim() ?? "";
}

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const url = req.nextUrl;
  const action = url.pathname.split("/").pop() ?? "";
  const ticker = getTicker(req);

  if (!ticker) {
    return jsonError("缺少 ticker 参数", 400, "MISSING_TICKER");
  }

  try {
    switch (action) {
      case "quote": {
        const { data, source } = await resolveQuote(ticker);
        return jsonOk({ data, source, mock: source === "mock" });
      }

      case "financials": {
        const { data, source } = await resolveFinancials(ticker);
        return jsonOk({
          data,
          source,
          mock: source === "mock",
          incomplete: data.incomplete ?? false,
        });
      }

      case "company": {
        const { data, source } = await resolveCompanyData(ticker);
        return jsonOk({
          data,
          source,
          mock: source === "mock",
          incomplete: data.incomplete ?? false,
        });
      }

      case "history": {
        const start = url.searchParams.get("start") ?? "";
        const end = url.searchParams.get("end") ?? "";
        if (!start || !end) {
          return jsonError("缺少 start 或 end 参数", 400, "MISSING_DATE");
        }

        const { data, source } = await resolvePriceHistory(ticker, start, end);
        await saveHistory(ticker, data);
        return jsonOk({ data, source, mock: source === "mock" });
      }

      default:
        return jsonError(`未知操作: ${action}`, 404, "UNKNOWN_ACTION");
    }
  } catch (err) {
    console.error("[ifind] 请求失败:", err);
    return jsonError("数据服务暂不可用，请稍后重试", 502, "IFIND_ERROR");
  }
}

async function saveHistory(
  ticker: string,
  bars: HistoryBar[],
) {
  if (!bars.length) return;

  const company = await prisma.company.findUnique({
    where: { ticker },
    select: { id: true },
  });

  for (const bar of bars) {
    await prisma.priceSnapshot.upsert({
      where: { ticker_date: { ticker, date: new Date(bar.date) } },
      update: { close: bar.close, volume: bar.volume ?? 0 },
      create: {
        ticker,
        date: new Date(bar.date),
        close: bar.close,
        volume: bar.volume ?? 0,
        companyId: company?.id,
      },
    });
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
