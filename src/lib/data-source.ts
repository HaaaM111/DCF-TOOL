/**
 * 数据源协调层（分流模式）
 * ------------------------------------------------------------------
 * 分流策略（省 iFinD token 额度）：
 *   - 实时行情 / 历史行情（高频调用）：东财（免费）→ iFinD → mock
 *   - 财务数据（低频、需权威口径）：iFinD → 东财（免费兜底，仅 A 股）→ mock
 *
 * 统一输出 { data, source }，source ∈ "ifind" | "eastmoney" | "mock"，
 * 路由层据此返回 source / mock 标记，前端可感知数据来源。
 *
 * 缓存与并发：
 *   - 行情缓存 60s、历史缓存 1h（模块级内存，与 ifind token 缓存同生命周期）
 *   - 同一标的的并发请求合并为单次上游调用（in-flight promise）
 */

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

/** 财务数据兜底可能不完整（Capex/D&A 等缺失）时置 true */
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

// ============================================================
// 缓存与并发合并
// ============================================================

interface CacheEntry<T> {
  data: T;
  source: DataSource;
  expiresAt: number;
}

const QUOTE_TTL_MS = 60 * 1000; // 行情缓存 60s
const HISTORY_TTL_MS = 60 * 60 * 1000; // 历史行情缓存 1h

const quoteCache = new Map<string, CacheEntry<Resolved<QuoteData>>>();
const historyCache = new Map<string, CacheEntry<Resolved<HistoryBar[]>>>();
// in-flight 合并：key → 进行中的 Promise
const inflight = new Map<string, Promise<unknown>>();

/** 获取缓存（未过期返回，否则删除） */
function getCached<T>(map: Map<string, CacheEntry<T>>, key: string) {
  const entry = map.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry;
  if (entry) map.delete(key);
  return null;
}

/** 并发合并：同一 key 的调用共享同一个 Promise */
async function withInflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ============================================================
// 数据源顺序配置
// ============================================================

/** 东财行情可用：开启 && 标的格式能被东财识别（5-6 位数字 + .SH/.SZ/.HK） */
function eastQuoteAvailable(ticker: string): boolean {
  return (
    isEastMoneyEnabled() && /^\d{5,6}\.(SH|SZ|HK)$/i.test(ticker.trim())
  );
}

// ============================================================
// 实时行情：东财 → iFinD → mock
// ============================================================

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
    // 1) 东财（分流主通道，免费）
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

    // 2) iFinD（有 token 时兜底）
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

    // 3) mock（开发模式最终兜底）
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

// ============================================================
// 财务数据：iFinD → 东财 → mock
// ============================================================

export async function resolveFinancials(
  ticker: string,
): Promise<Resolved<FinancialsResult>> {
  // 1) iFinD（权威口径，主通道）
  if (hasIfindCredentials()) {
    try {
      const f = await fetchFinancials(ticker);
      return { source: "ifind", data: f };
    } catch {
      // iFinD 失败，落到东财兜底
    }
  }

  // 2) 东财兜底（免费；仅 A 股，港股会抛错）
  if (isEastMoneyEnabled()) {
    try {
      const f = await fetchEastFinancials(ticker);
      return { source: "eastmoney", data: f };
    } catch {
      // 东财失败或港股不支持，落到 mock
    }
  }

  // 3) mock（开发模式最终兜底）
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

// ============================================================
// 行情 + 财务合并（新增标的一键填充）
// ============================================================

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

  // marketCap 用财务股本 × 最新价（与 ifind-client.fetchCompanyData 一致）
  const marketCap = Number((quote.data.close * fin.data.shares).toFixed(2));
  const data: CompanyData = {
    ...fin.data,
    ticker,
    currentPrice: quote.data.close,
    volume: quote.data.volume,
    marketCap,
    industry: "",
  };

  // source 以财务来源为准（财务是本场景的数据核心），行情来源不单独暴露
  return { source: fin.source, data };
}

// ============================================================
// 历史行情：东财 → iFinD → 空
// ============================================================

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
    // 1) 东财（分流主通道，免费）
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

    // 2) iFinD（有 token 时兜底）
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
