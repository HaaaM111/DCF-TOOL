import "server-only";
import { z } from "zod";
import { resolvePriceHistory } from "./data-source";
import { chinaMarketDate, quoteDateFromUnix } from "./financial-data-quality";
import { fetchIfindMarketQuotes, hasIfindCredentials } from "./ifind-client";
import { type MarketQuote, type MarketQuotes } from "./market-quote";
import { mainlandCloseWindow } from "./peer-selection";

const snapshotEnvelope = z.object({ errorcode: z.literal(0), tables: z.array(z.unknown()) });
const snapshotRow = z.object({
  thscode: z.string(),
  time: z.array(z.string()),
  table: z.object({ latest: z.array(z.unknown()) }),
});

export function parseIfindMarketQuotes(raw: unknown, tickers: string[], now: Date) {
  const quotes = new Map<string, MarketQuote>();
  const response = snapshotEnvelope.safeParse(raw);
  if (!response.success) return quotes;
  const requested = new Set(tickers);
  const today = chinaMarketDate(now);
  for (const value of response.data.tables) {
    const row = snapshotRow.safeParse(value);
    if (!row.success) continue;
    const ticker = row.data.thscode.toUpperCase();
    if (!requested.has(ticker)) continue;
    for (const [index, time] of row.data.time.entries()) {
      const price = row.data.table.latest[index];
      if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 ||
          !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(time)) continue;
      const seconds = Date.parse(time.replace(" ", "T") + "+08:00") / 1000;
      const date = quoteDateFromUnix(seconds, now.getTime());
      if (date !== time.slice(0, 10) || date > today || seconds * 1000 > now.getTime()) continue;
      const timestamp = time.replace(" ", "T") + "+08:00";
      const previous = quotes.get(ticker);
      if (previous?.kind === "snapshot" && previous.timestamp >= timestamp) continue;
      quotes.set(ticker, { price, date, kind: "snapshot", source: "ifind", timestamp });
    }
  }
  return quotes;
}

const cache = new Map<string, { quote: MarketQuote | null; expiresAt: number }>();
const inFlight = new Map<string, Promise<MarketQuote | null>>();

async function within<T>(work: Promise<T>, milliseconds: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<null>(resolve => {
      timeout = setTimeout(() => resolve(null), milliseconds);
    })]);
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function marketCloseWindow(ticker: string, now: Date) {
  const offset = /\.HK$/i.test(ticker) ? 3600_000 : 0;
  const { start, end } = mainlandCloseWindow(new Date(now.getTime() - offset));
  const day = new Date(end);
  const weekday = day.getUTCDay();
  if (weekday === 0 || weekday === 6) day.setUTCDate(day.getUTCDate() - (weekday === 0 ? 2 : 1));
  return { start, end: day.toISOString().slice(0, 10) };
}

async function resolveTickerQuote(ticker: string, snapshot: MarketQuote | null, now: Date): Promise<MarketQuote | null> {
  const { start, end } = marketCloseWindow(ticker, now);
  if (snapshot && snapshot.date >= end) return snapshot;
  const history = await within(resolvePriceHistory(ticker, start, end), 6000);
  if (!history || history.source === "mock") return snapshot;
  const newest = history.data.filter(({ date, close }) => date >= start && date <= end && Number.isFinite(close) && close > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return newest && (!snapshot || newest.date > snapshot.date)
    ? { price: newest.close, date: newest.date, kind: "daily-close", source: history.source }
    : snapshot;
}

export async function loadMarketQuotes(tickers: string[]): Promise<MarketQuotes> {
  const now = new Date();
  const missing = tickers.filter(ticker => /^(\d{6}\.(SH|SZ|BJ)|\d{5}\.HK)$/.test(ticker) &&
    (cache.get(ticker)?.expiresAt ?? 0) <= now.getTime() && !inFlight.has(ticker));
  if (missing.length) {
    const snapshots = hasIfindCredentials()
      ? within(fetchIfindMarketQuotes(missing), 5000).then(raw => parseIfindMarketQuotes(raw, missing, now))
      : Promise.resolve(new Map<string, MarketQuote>());
    for (const ticker of missing) {
      const request = snapshots.then(quotes => resolveTickerQuote(ticker, quotes.get(ticker) ?? null, now))
        .then(quote => {
          cache.delete(ticker);
          cache.set(ticker, { quote, expiresAt: Date.now() + (quote ? 45_000 : 15_000) });
          const oldest = cache.keys().next().value;
          if (cache.size > 512 && oldest !== undefined) cache.delete(oldest);
          return quote;
        })
        .finally(() => inFlight.delete(ticker));
      inFlight.set(ticker, request);
    }
  }
  return Object.fromEntries(await Promise.all(tickers.map(async ticker =>
    [ticker, inFlight.has(ticker) ? await inFlight.get(ticker) : cache.get(ticker)?.quote ?? null])));
}
