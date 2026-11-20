import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { createMarketNewsReader, MARKET_NEWS_SOURCES, mergeMarketNews, parseMarketNews, parseSinaMarketNews } from "@/lib/market-news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchNews(url: URL | string, originPage: string) {
  const response = await fetch(url, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(7000),
    headers: { Accept: "application/json", Referer: originPage },
  });
  if (!response.ok) throw new Error("Unable to read market news");
  return response.json();
}

const readEastmoney = createMarketNewsReader(async () => {
  const url = new URL("https://np-weblist.eastmoney.com/comm/web/getFastNewsList");
  url.search = new URLSearchParams({ client: "web", biz: "web_724", fastColumn: "102",
    sortEnd: "", pageSize: "35", req_trace: randomUUID() }).toString();
  return parseMarketNews(await fetchNews(url, MARKET_NEWS_SOURCES.eastmoney.url), Date.now());
});

const readSina = createMarketNewsReader(async () => parseSinaMarketNews(await fetchNews(
  "https://zhibo.sina.com.cn/api/zhibo/feed?zhibo_id=152&page=1&page_size=35&type=0",
  MARKET_NEWS_SOURCES.sina.url,
), Date.now()));

export async function GET(request: NextRequest) {
  const guard = guardRequest(request);
  if (guard) return guard;
  const feeds = (await Promise.all([readEastmoney(), readSina()])).filter((feed) => feed !== undefined);
  if (!feeds.length) return jsonError("财经快讯暂时不可用，请稍后重试", 503, "MARKET_NEWS_UNAVAILABLE");
  return jsonOk({
    items: mergeMarketNews(feeds.map((feed) => feed.items)),
    updatedAt: feeds.map((feed) => feed.updatedAt).sort().at(-1),
    stale: feeds.every((feed) => feed.stale),
  });
}
