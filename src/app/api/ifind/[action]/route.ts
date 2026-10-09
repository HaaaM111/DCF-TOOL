/**
 * iFinD 数据代理路由（统一入口，分流模式）
 * GET /api/ifind/quote?ticker=xxx       —— 最新行情（东财 → iFinD → mock）
 * GET /api/ifind/financials?ticker=xxx  —— 财务数据（iFinD → 东财 → mock）
 * GET /api/ifind/company?ticker=xxx     —— 行情+财务合并（新增标的用）
 * GET /api/ifind/history?ticker=xxx&start=YYYY-MM-DD&end=YYYY-MM-DD  —— 历史行情（东财 → iFinD → 空）
 *
 * 响应统一带 source（ifind | eastmoney | mock）与 mock 布尔标记；
 * 财务数据兜底不完整时带 incomplete 标记。
 *
 * 安全：Token 仅在服务端使用，绝不返回前端；所有外部响应经 Zod 校验后再返回。
 */
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
    // 不向前端透出内部错误细节（可能含接口地址/凭据信息），仅记录服务端日志
    console.error("[ifind] 请求失败:", err);
    return jsonError("数据服务暂不可用，请稍后重试", 502, "IFIND_ERROR");
  }
}

/**
 * 将历史行情批量写入 PriceSnapshot（UPSERT，同一 ticker+date 去重）
 */
async function saveHistory(
  ticker: string,
  bars: HistoryBar[],
) {
  if (!bars.length) return;

  // 查找对应 companyId（用户库）
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
