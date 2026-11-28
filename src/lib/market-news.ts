import { z } from "zod";

export const MARKET_NEWS_SOURCES = {
  eastmoney: { label: "东方财富", url: "https://kuaixun.eastmoney.com/" },
  sina: { label: "新浪财经", url: "https://finance.sina.com.cn/7x24/" },
} as const;
export const MARKET_NEWS_POLL_MS = 60_000;
export const MARKET_NEWS_BATCH_SIZE = 13;

export interface MarketNewsItem {
  id: string;
  source: keyof typeof MARKET_NEWS_SOURCES;
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
const sinaSchema = z.object({ result: z.object({ data: z.object({ feed: z.object({
  list: z.array(z.unknown()).max(50),
}) }) }) });
const sinaRow = z.object({
  id: z.coerce.string().regex(/^\d{1,18}$/),
  rich_text: z.string().trim().min(1).max(4000),
  create_time: z.string(),
  docurl: z.string().max(500).nullish(),
});
const rowSchema = z.object({
  code: z.string().regex(/^\d{12,30}$/),
  title: z.string().trim().min(1).max(300),
  showTime: z.iso.datetime({ local: true, precision: 0 }),
});
const localTime = z.iso.datetime({ local: true, precision: 0 });

function timeInBeijing(value: string, now: number) {
  const local = value.replace(" ", "T");
  if (!localTime.safeParse(local).success || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(local)) return null;
  const timestamp = Date.parse(local + "+08:00");
  return Number.isFinite(timestamp) && timestamp <= now + 300_000 ? new Date(timestamp).toISOString() : null;
}

export function parseMarketNews(response: unknown, now: number): MarketNewsItem[] {
  const rows = responseSchema.parse(response).data.fastNewsList;
  const items = rows.flatMap((row) => {
    const candidate = row && typeof row === "object" && "showTime" in row && typeof row.showTime === "string"
      ? { ...row, showTime: row.showTime.replace(" ", "T") }
      : row;
    const result = rowSchema.safeParse(candidate);
    if (!result.success) return [];
    const { code, showTime, title } = result.data;
    const publishAt = timeInBeijing(showTime, now);
    return publishAt ? [{ id: `eastmoney:${code}`, source: "eastmoney" as const, title, publishAt, url: `https://finance.eastmoney.com/a/${code}.html` }] : [];
  });
  return deduplicateNews(items);
}

export function parseSinaMarketNews(response: unknown, now: number): MarketNewsItem[] {
  return deduplicateNews(sinaSchema.parse(response).result.data.feed.list.flatMap((row) => {
    const parsed = sinaRow.safeParse(row);
    if (!parsed.success) return [];
    const { id, rich_text, create_time, docurl } = parsed.data;
    const publishAt = timeInBeijing(create_time, now);
    if (!publishAt) return [];
    const heading = rich_text.match(/^[【〖]([^】〗]+)[】〗]/u)?.[1] ?? rich_text.split(/[。！？\n]/u)[0];
    const title = heading.replace(/<[^>]*>/g, "").trim();
    if (!title || title.length > 140) return [];
    const url = docurl && /^https:\/\/finance\.sina\.(cn|com\.cn)\/7x24\/[A-Za-z0-9/._-]+$/i.test(docurl)
      ? docurl : `${MARKET_NEWS_SOURCES.sina.url}?id=${id}`;
    return [{ id: `sina:${id}`, source: "sina" as const, title, publishAt, url }];
  }));
}

function deduplicateNews(items: MarketNewsItem[]): MarketNewsItem[] {
  const ids = new Set<string>();
  const titles = new Set<string>();
  return [...items].sort((a, b) => b.publishAt.localeCompare(a.publishAt)).filter((item) => {
    const title = item.title.normalize("NFKC").replace(/[\s\p{P}]/gu, "");
    if (!title) return false;
    if (ids.has(item.id) || titles.has(title)) return false;
    ids.add(item.id);
    titles.add(title);
    return true;
  });
}

/** Interleave recent headlines so a faster feed cannot crowd out the other one. */
export function mergeMarketNews(feeds: MarketNewsItem[][]): MarketNewsItem[] {
  const unique = deduplicateNews(feeds.flat());
  const newest = Date.parse(unique[0]?.publishAt ?? "");
  const recent = unique.filter((item) => Date.parse(item.publishAt) >= newest - 24 * 60 * 60 * 1000);
  const sources = [...new Set(recent.map((item) => item.source))];
  const queues = sources.map((source) => recent.filter((item) => item.source === source));
  return Array.from({ length: Math.max(0, ...queues.map((queue) => queue.length)) },
    (_, index) => queues.flatMap((queue) => queue[index] ?? [])).flat();
}

export function marketNewsBatch(items: MarketNewsItem[], batch: number) {
  if (items.length <= MARKET_NEWS_BATCH_SIZE) return items;
  const start = (batch * MARKET_NEWS_BATCH_SIZE) % items.length;
  const next = items.slice(start, start + MARKET_NEWS_BATCH_SIZE);
  return next.concat(items.slice(0, MARKET_NEWS_BATCH_SIZE - next.length));
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
