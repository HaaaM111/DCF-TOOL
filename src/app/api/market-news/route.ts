import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { createMarketNewsReader, MARKET_NEWS_SOURCE_URL, parseMarketNews } from "@/lib/market-news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const readMarketNews = createMarketNewsReader(async () => {
  const url = new URL("https://np-weblist.eastmoney.com/comm/web/getFastNewsList");
  url.search = new URLSearchParams({ client: "web", biz: "web_724", fastColumn: "102",
    sortEnd: "", pageSize: "20", req_trace: randomUUID() }).toString();
  const response = await fetch(url, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(7000),
    headers: { Accept: "application/json", Referer: MARKET_NEWS_SOURCE_URL },
  });
  if (!response.ok) throw new Error("Unable to read market news");
  return parseMarketNews(await response.json(), Date.now());
});

export async function GET(request: NextRequest) {
  const guard = guardRequest(request);
  if (guard) return guard;
  const feed = await readMarketNews();
  return feed ? jsonOk(feed) : jsonError("财经快讯暂时不可用，请稍后重试", 503, "MARKET_NEWS_UNAVAILABLE");
}
