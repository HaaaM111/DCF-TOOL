import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const newsResponseSchema = z.object({
  data: z
    .object({
      list: z
        .array(
          z.object({
            code: z.string().optional(),
            title: z.string(),
            summary: z.string().optional(),
            showTime: z.string(),
            mediaName: z.string().optional(),
            uniqueUrl: z.string().optional(),
            url: z.string().optional(),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
});

function safeNewsUrl(raw: string | undefined) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (!/(^|\.)eastmoney\.com$/i.test(url.hostname)) return "";
    url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const params = new URLSearchParams({
      client: "web",
      biz: "web_news_col",
      column: "345",
      order: "1",
      needInteractData: "0",
      page_index: "1",
      page_size: "20",
      req_trace: randomUUID(),
    });
    const res = await fetch(
      `https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?${params}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://finance.eastmoney.com/",
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!res.ok) throw new Error(`资讯源返回 HTTP ${res.status}`);

    const parsed = newsResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("资讯源响应格式已变化");

    const news = (parsed.data.data?.list ?? [])
      .filter((item) => item.title.trim() && item.showTime)
      .slice(0, 16)
      .map((item, index) => ({
        id: item.code ?? `${item.showTime}-${index}`,
        title: item.title.trim(),
        summary: item.summary?.trim() ?? "",
        source: item.mediaName?.trim() || "东方财富",
        publishedAt: item.showTime,
        url: safeNewsUrl(item.uniqueUrl ?? item.url),
      }));

    return jsonOk({
      news,
      source: "东方财富",
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "[news] 实时资讯获取失败:",
      error instanceof Error ? error.message : error,
    );
    return jsonError("实时资讯暂时不可用，请稍后重试", 503, "NEWS_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

export async function OPTIONS(req: NextRequest) {
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
