/**
 * 巨潮资讯（cninfo）公告客户端 —— A股公告采集模块
 * ------------------------------------------------------------------
 * 接口均已实测（2026-10-09）：
 *   - orgId 查询：POST /new/information/topSearch/query（按代码查，沪深通用）
 *     （注：/new/data/sse_stock.json 已 404，不依赖股票列表文件）
 *   - 公告查询：POST /new/hisAnnouncement/query
 *     stock 参数逗号需 URL 编码（URLSearchParams 自动处理）
 *   - PDF 全文：http://static.cninfo.com.cn/ + adjunctUrl
 * 安全设计：仅服务端使用；响应用 zod 校验，字段漂移时在此单点兜底。
 */
import { z } from "zod";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0";
const REFERER = "http://www.cninfo.com.cn/";
const ORG_ID_CACHE_TTL_MS = 10 * 60 * 1000; // orgId 缓存 10 分钟
const MAX_PAGES = 3; // 按需场景翻页上限（pageSize=30，足够覆盖近 30 天）

export type Market = "SZ" | "SH";

/** 公告查询接口返回的原始字段 */
export interface CninfoAnnouncement {
  announcementId: string; // 去重键
  title: string;
  publishAt: Date; // 毫秒时间戳转换
  pdfUrl: string; // 全文 PDF 地址
  secCode: string;
  secName: string;
  adjunctSizeKb: number; // PDF 大小（KB），超大文件多为扫描件
}

const topSearchSchema = z.array(
  z.object({ code: z.string(), orgId: z.string().optional() }),
);

const rawAnnouncementSchema = z.object({
  announcementId: z.union([z.string(), z.number()]),
  announcementTitle: z.string(),
  announcementTime: z.number().optional(), // 毫秒时间戳
  adjunctUrl: z.string().optional(),
  secCode: z.string().optional(),
  secName: z.string().optional(),
  adjunctSize: z.union([z.number(), z.string()]).optional(),
});

const queryResponseSchema = z.object({
  announcements: z.array(rawAnnouncementSchema).optional().default([]),
  hasMore: z.boolean().optional().default(false),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let orgIdCache: Map<string, string> = new Map();
let orgIdCacheAt = 0;

/** 按证券代码查询巨潮 orgId（沪深通用），10 分钟内存缓存 */
export async function fetchOrgId(secCode: string): Promise<string | null> {
  if (Date.now() - orgIdCacheAt > ORG_ID_CACHE_TTL_MS) {
    orgIdCache = new Map();
    orgIdCacheAt = Date.now();
  }
  const cached = orgIdCache.get(secCode);
  if (cached) return cached;

  const res = await fetch("http://www.cninfo.com.cn/new/information/topSearch/query", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Referer: REFERER,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ keyWord: secCode }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`巨潮 orgId 查询失败: HTTP ${res.status}`);
  }
  const list = topSearchSchema.parse(await res.json());
  const hit = list.find((x) => x.code === secCode);
  if (hit?.orgId) {
    orgIdCache.set(secCode, hit.orgId);
    return hit.orgId;
  }
  return null;
}

/** 市场 -> 巨潮 column 参数（szse 深市 / sse 沪市） */
export function columnOf(market: Market): "szse" | "sse" {
  return market === "SZ" ? "szse" : "sse";
}

/** 拉某公司一段时间内的公告（自动翻页至 hasMore=false 或翻页上限） */
export async function fetchAnnouncements(
  secCode: string,
  orgId: string,
  market: Market,
  from: string, // YYYY-MM-DD
  to: string, // YYYY-MM-DD
  pageSize = 30,
): Promise<CninfoAnnouncement[]> {
  const column = columnOf(market);
  const out: CninfoAnnouncement[] = [];
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const body = new URLSearchParams({
      pageNum: String(pageNum),
      pageSize: String(pageSize),
      column,
      tabName: "fulltext",
      stock: `${secCode},${orgId}`,
      seDate: `${from}~${to}`,
      isHLtitle: "true",
    }).toString();
    const res = await fetch("http://www.cninfo.com.cn/new/hisAnnouncement/query", {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Referer: REFERER,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      throw new Error(`巨潮公告查询失败: HTTP ${res.status}`);
    }
    const json = queryResponseSchema.parse(await res.json());
    for (const a of json.announcements) {
      if (!a.announcementId || !a.announcementTitle) continue;
      const adjunct = a.adjunctUrl ?? "";
      out.push({
        announcementId: String(a.announcementId),
        title: a.announcementTitle,
        publishAt: a.announcementTime ? new Date(a.announcementTime) : new Date(),
        pdfUrl: adjunct ? `http://static.cninfo.com.cn/${adjunct}` : "",
        secCode: a.secCode ?? secCode,
        secName: a.secName ?? "",
        adjunctSizeKb: typeof a.adjunctSize === "number" ? a.adjunctSize : Number(a.adjunctSize ?? 0),
      });
    }
    if (!json.hasMore) break;
    await sleep(300);
  }
  return out;
}
