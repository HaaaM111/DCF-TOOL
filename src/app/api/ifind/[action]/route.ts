import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserId, isAdministrator } from "@/lib/auth";
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
  const guard = await guardRequest(req);
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
        await saveHistory(ticker, data, getAuthenticatedUserId(req), isAdministrator(req));
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
  userId: string,
  isAdmin: boolean,
) {
  if (!bars.length) return;

  const company = await prisma.company.findFirst({
    where: { ticker, ...(isAdmin ? {} : { userId }) },
    select: { id: true },
  });

  for (const bar of bars) {
    // 同一交易日只保留一条快照：开盘/盘中/收盘多次同步都会落到同一个自然日，
    // 否则走势图会出现同日多点、K 线状抖动。
    const day = new Date(`${bar.date.slice(0, 10)}T00:00:00.000Z`);
    await prisma.priceSnapshot.upsert({
      where: { ticker_date: { ticker, date: day } },
      update: { close: bar.close, volume: bar.volume ?? 0, companyId: company?.id },
      create: {
        ticker,
        date: day,
        close: bar.close,
        volume: bar.volume ?? 0,
        companyId: company?.id,
      },
    });
  }
}

export async function OPTIONS(req: NextRequest) {
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
