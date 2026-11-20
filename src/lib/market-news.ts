import { z } from "zod";

export const MARKET_NEWS_SOURCE_URL = "https://kuaixun.eastmoney.com/";
export const MARKET_NEWS_POLL_MS = 60_000;

export interface MarketNewsItem {
  id: string;
  title: string;
  publishAt: string;
  url: string;
}

export interface MarketNewsFeed {
  items: MarketNewsItem[];
  updatedAt: string;
  stale: boolean;
}

const responseSchema = z.object({ data: z.object({ fastNewsList: z.array(z.unknown()).max(50) }) });
const rowSchema = z.object({
  code: z.string().regex(/^\d{12,30}$/),
  title: z.string().trim().min(1).max(300),
  showTime: z.iso.datetime({ local: true, precision: 0 }),
});

export function parseMarketNews(response: unknown, now: number): MarketNewsItem[] {
  const rows = responseSchema.parse(response).data.fastNewsList;
  const items = rows.flatMap((row) => {
    const candidate = row && typeof row === "object" && "showTime" in row && typeof row.showTime === "string"
      ? { ...row, showTime: row.showTime.replace(" ", "T") }
      : row;
    const result = rowSchema.safeParse(candidate);
    if (!result.success) return [];
    const { code, showTime, title } = result.data;
    const timestamp = Date.parse(showTime + "+08:00");
    if (!Number.isFinite(timestamp) || timestamp > now + 300_000) return [];
    return [{ id: code, title, publishAt: new Date(timestamp).toISOString(), url: `https://finance.eastmoney.com/a/${code}.html` }];
  }).sort((a, b) => b.publishAt.localeCompare(a.publishAt));
  const ids = new Set<string>();
  const titles = new Set<string>();
  return items.filter((item) => {
    const title = item.title.replace(/\s+/g, "");
    if (ids.has(item.id) || titles.has(title)) return false;
    ids.add(item.id);
    titles.add(title);
    return true;
  }).slice(0, 13);
}

/** Share one in-flight refresh across users and back off briefly on upstream errors. */
export function createMarketNewsReader(fetchLatest: () => Promise<MarketNewsItem[]>, now = Date.now) {
  let snapshot: MarketNewsFeed | undefined;
  let retryAt = 0;
  let pending: Promise<MarketNewsFeed | undefined> | undefined;
  return function read(): Promise<MarketNewsFeed | undefined> {
    if (pending) return pending;
    if (now() < retryAt) return Promise.resolve(snapshot);
    pending = Promise.resolve().then(fetchLatest).then((items) => {
      if (items.length === 0) throw new Error("Empty market news response");
      snapshot = { items, updatedAt: new Date(now()).toISOString(), stale: false };
      retryAt = now() + 45_000;
      return snapshot;
    }).catch(() => {
      retryAt = now() + 30_000;
      if (snapshot) snapshot = { ...snapshot, stale: true };
      return snapshot;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
