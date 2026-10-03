/**
 * iFinD 数据代理路由（统一入口）
 * GET /api/ifind/quote?ticker=xxx       —— 最新行情
 * GET /api/ifind/financials?ticker=xxx  —— 财务数据
 * GET /api/ifind/company?ticker=xxx     —— 行情+财务合并（新增标的用）
 * GET /api/ifind/history?ticker=xxx&start=YYYY-MM-DD&end=YYYY-MM-DD  —— 历史行情（落库 PriceSnapshot）
 *
 * 安全：Token 仅在服务端使用，绝不返回前端；所有 iFinD 响应经 Zod 校验后再返回。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma, prismaBase } from "@/lib/prisma";
import {
  fetchQuote,
  fetchFinancials,
  fetchCompanyData,
  fetchPriceHistory,
  hasIfindCredentials,
  getMockCompanyData,
} from "@/lib/ifind-client";

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

  const useMock = !hasIfindCredentials();

  try {
    switch (action) {
      case "quote": {
        const data = useMock
          ? { ticker, close: getMockCompanyData(ticker).currentPrice, volume: 0 }
          : await fetchQuote(ticker);
        return jsonOk({ data, mock: useMock });
      }

      case "financials": {
        const data = useMock
          ? getMockCompanyData(ticker)
          : await fetchFinancials(ticker);
        return jsonOk({ data, mock: useMock });
      }

      case "company": {
        // 行情 + 财务合并，用于"新增标的"一键填充
        const data = useMock
          ? getMockCompanyData(ticker)
          : await fetchCompanyData(ticker);
        return jsonOk({ data, mock: useMock });
      }

      case "history": {
        const start = url.searchParams.get("start") ?? "";
        const end = url.searchParams.get("end") ?? "";
        if (!start || !end) {
          return jsonError("缺少 start 或 end 参数", 400, "MISSING_DATE");
        }

        if (useMock) {
          // mock 模式：生成 90 天模拟行情并落库
          const bars = generateMockHistory(ticker, start, end);
          await saveHistory(ticker, bars);
          return jsonOk({ data: bars, mock: true });
        }

        const bars = await fetchPriceHistory(ticker, start, end);
        await saveHistory(ticker, bars);
        return jsonOk({ data: bars, mock: false });
      }

      default:
        return jsonError(`未知操作: ${action}`, 404, "UNKNOWN_ACTION");
    }
  } catch (err) {
    // 不向前端透出内部错误细节（可能含接口地址/凭据信息），仅记录服务端日志
    console.error("[ifind] 请求失败:", err);
    return jsonError("iFinD 数据服务暂不可用，请稍后重试", 502, "IFIND_ERROR");
  }
}

/**
 * 将历史行情批量写入 PriceSnapshot（UPSERT，同一 ticker+date 去重）
 */
async function saveHistory(
  ticker: string,
  bars: { date: string; close: number; volume?: number }[],
) {
  if (!bars.length) return;

  // 查找对应 companyId（若存在，基准库）
  const company = await prismaBase.company.findUnique({
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

/**
 * Mock 历史行情生成器：基于 ticker 哈希生成稳定的 90 天价格序列
 */
function generateMockHistory(
  ticker: string,
  start: string,
  end: string,
): { date: string; close: number; volume: number }[] {
  const base = getMockCompanyData(ticker).currentPrice;
  const bars: { date: string; close: number; volume: number }[] = [];
  const startDate = new Date(start);
  const endDate = new Date(end);
  const seed = Array.from(ticker).reduce((s, c) => s + c.charCodeAt(0), 0);

  let price = base;
  const cur = new Date(startDate);
  let i = 0;
  while (cur <= endDate) {
    // 伪随机游走
    const r = Math.sin(seed + i * 1.7) * 0.02;
    price = Math.max(1, price * (1 + r));
    bars.push({
      date: cur.toISOString().slice(0, 10),
      close: Number(price.toFixed(2)),
      volume: 1000000 + Math.abs(Math.sin(seed + i)) * 5000000,
    });
    cur.setDate(cur.getDate() + 1);
    i++;
  }
  return bars;
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
