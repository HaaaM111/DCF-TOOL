
import {
  fetchEastQuote,
  fetchEastPriceHistory,
  fetchEastFinancials,
  isEastMoneyEnabled,
} from "./eastmoney-client";
import {
  fetchQuote,
  fetchFinancials,
  fetchPriceHistory,
  getMockCompanyData,
  hasIfindCredentials,
} from "./ifind-client";

export type DataSource = "ifind" | "eastmoney" | "mock";

export interface Resolved<T> {
  data: T;
  source: DataSource;
}

export interface FinancialsResult {
  ticker: string;
  name: string;
  cash: number;
  debt: number;
  shares: number;
  cfo: number;
  capex: number;
  da: number;
  e0: number;
  revenue: number;
  bookValue: number;
  totalAssets: number;
  reportDate: string;
  incomplete?: boolean;
}

interface CacheEntry<T> {
  data: T;
  source: DataSource;
  expiresAt: number;
}

const QUOTE_TTL_MS = 60 * 1000;
const HISTORY_TTL_MS = 60 * 60 * 1000;

const quoteCache = new Map<string, CacheEntry<Resolved<QuoteData>>>();
const historyCache = new Map<string, CacheEntry<Resolved<HistoryBar[]>>>();
const inflight = new Map<string, Promise<unknown>>();

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string) {
  const entry = map.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry;
  if (entry) map.delete(key);
  return null;
}

async function withInflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function eastQuoteAvailable(ticker: string): boolean {
  return (
    isEastMoneyEnabled() && /^\d{5,6}\.(SH|SZ|HK)$/i.test(ticker.trim())
  );
}

interface QuoteData {
  ticker: string;
  close: number;
  volume: number;
  date: string;
}

export async function resolveQuote(ticker: string): Promise<Resolved<QuoteData>> {
  const cacheKey = `quote:${ticker}`;
  const cached = getCached(quoteCache, cacheKey);
  if (cached) return cached.data;

  const result = await withInflight(cacheKey, async () => {
    if (eastQuoteAvailable(ticker)) {
      try {
        const q = await fetchEastQuote(ticker);
        const resolved: Resolved<QuoteData> = {
          source: "eastmoney",
          data: { ticker, close: q.close, volume: q.volume, date: q.date },
        };
        quoteCache.set(cacheKey, {
          data: resolved,
          source: "eastmoney",
          expiresAt: Date.now() + QUOTE_TTL_MS,
        });
        return resolved;
      } catch {
        // 东财失败，落到 iFinD
      }
    }

    if (hasIfindCredentials()) {
      try {
        const q = await fetchQuote(ticker);
        const resolved: Resolved<QuoteData> = {
          source: "ifind",
          data: { ticker, close: q.close, volume: q.volume, date: q.date },
        };
        quoteCache.set(cacheKey, {
          data: resolved,
          source: "ifind",
          expiresAt: Date.now() + QUOTE_TTL_MS,
        });
        return resolved;
      } catch {
        // iFinD 失败，落到 mock
      }
    }

    const mock = getMockCompanyData(ticker);
    const resolved: Resolved<QuoteData> = {
      source: "mock",
      data: {
        ticker,
        close: mock.currentPrice,
        volume: mock.volume,
        date: new Date().toISOString().slice(0, 10),
      },
    };
    quoteCache.set(cacheKey, {
      data: resolved,
      source: "mock",
      expiresAt: Date.now() + QUOTE_TTL_MS,
    });
    return resolved;
  });

  return result as Resolved<QuoteData>;
}

export async function resolveFinancials(
  ticker: string,
): Promise<Resolved<FinancialsResult>> {
  if (hasIfindCredentials()) {
    try {
      const f = await fetchFinancials(ticker);
      return { source: "ifind", data: f };
    } catch {
      // iFinD 失败，落到东财兜底
    }
  }

  if (isEastMoneyEnabled()) {
    try {
      const f = await fetchEastFinancials(ticker);
      return { source: "eastmoney", data: f };
    } catch {
      // 东财失败或港股不支持，落到 mock
    }
  }

  const mock = getMockCompanyData(ticker);
  return {
    source: "mock",
    data: {
      ticker,
      name: mock.name,
      cash: mock.cash,
      debt: mock.debt,
      shares: mock.shares,
      cfo: mock.cfo,
      capex: mock.capex,
      da: mock.da,
      e0: mock.e0,
      revenue: mock.revenue,
      bookValue: mock.bookValue,
      totalAssets: mock.totalAssets,
      reportDate: mock.reportDate,
    },
  };
}

export interface CompanyData extends FinancialsResult {
  currentPrice: number;
  volume: number;
  marketCap: number;
  industry?: string;
}

export async function resolveCompanyData(
  ticker: string,
): Promise<Resolved<CompanyData>> {
  const [quote, fin] = await Promise.all([
    resolveQuote(ticker),
    resolveFinancials(ticker),
  ]);

  const marketCap = Number((quote.data.close * fin.data.shares).toFixed(2));
  const data: CompanyData = {
    ...fin.data,
    ticker,
    currentPrice: quote.data.close,
    volume: quote.data.volume,
    marketCap,
    industry: "",
  };

  return { source: fin.source, data };
}

export interface HistoryBar {
  date: string;
  close: number;
  volume?: number;
}

export async function resolvePriceHistory(
  ticker: string,
  start: string,
  end: string,
): Promise<Resolved<HistoryBar[]>> {
  const cacheKey = `history:${ticker}:${start}:${end}`;
  const cached = getCached(historyCache, cacheKey);
  if (cached) return cached.data;

  const result = await withInflight(cacheKey, async () => {
    if (eastQuoteAvailable(ticker)) {
      try {
        const bars = await fetchEastPriceHistory(ticker, start, end);
        const resolved: Resolved<HistoryBar[]> = {
          source: "eastmoney",
          data: bars,
        };
        historyCache.set(cacheKey, {
          data: resolved,
          source: "eastmoney",
          expiresAt: Date.now() + HISTORY_TTL_MS,
        });
        return resolved;
      } catch {
        // 落到 iFinD
      }
    }

    if (hasIfindCredentials()) {
      try {
        const bars = await fetchPriceHistory(ticker, start, end);
        const resolved: Resolved<HistoryBar[]> = { source: "ifind", data: bars };
        historyCache.set(cacheKey, {
          data: resolved,
          source: "ifind",
          expiresAt: Date.now() + HISTORY_TTL_MS,
        });
        return resolved;
      } catch {
        // 落到空数组（历史行情无 mock 的意义）
      }
    }

    const resolved: Resolved<HistoryBar[]> = { source: "mock", data: [] };
    historyCache.set(cacheKey, {
      data: resolved,
      source: "mock",
      expiresAt: Date.now() + HISTORY_TTL_MS,
    });
    return resolved;
  });

  return result as Resolved<HistoryBar[]>;
}
