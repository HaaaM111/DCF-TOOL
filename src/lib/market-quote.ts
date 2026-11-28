export const MARKET_QUOTE_BATCH_SIZE = 12;
export const MARKET_QUOTE_POLL_MS = 60_000;

export type MarketQuote =
  | { price: number; date: string; kind: "snapshot"; source: "ifind"; timestamp: string }
  | { price: number; date: string; kind: "daily-close"; source: "ifind" | "eastmoney" };

export type MarketQuotes = Record<string, MarketQuote | null>;

export function marketQuotePrice(price: number, ticker: string) {
  const currency = /\.HK$/i.test(ticker) ? "HKD" : /\.(SH|SZ|BJ)$/i.test(ticker) ? "CNY" : "";
  return new Intl.NumberFormat("zh-CN", {
    ...(currency ? { style: "currency", currency, currencyDisplay: "narrowSymbol" } : {}),
    minimumFractionDigits: 2, maximumFractionDigits: 3,
  }).format(price);
}

export function marketQuoteCaption(quote: MarketQuote | null | undefined, failed: boolean) {
  if (!quote) return failed ? "行情暂不可用 · 档案价" : "档案价";
  const source = quote.source === "ifind" ? "iFinD" : "东方财富";
  const detail = quote.kind === "snapshot"
    ? `${quote.date} ${quote.timestamp.slice(11, 19)}`
    : `${quote.date} 收盘`;
  return `${detail} · ${source}${failed ? " · 刷新失败" : ""}`;
}
