"use client";

import { useEffect, useState } from "react";
import { MARKET_QUOTE_BATCH_SIZE, MARKET_QUOTE_POLL_MS, type MarketQuotes } from "@/lib/market-quote";

export function useMarketQuotes(tickers: string[], refreshKey = 0) {
  const key = [...new Set(tickers.map(ticker => ticker.toUpperCase()))].sort().join(",");
  const [quotes, setQuotes] = useState<MarketQuotes>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const symbols = key.split(",");
    const batches = Array.from({ length: Math.ceil(symbols.length / MARKET_QUOTE_BATCH_SIZE) }, (_, index) =>
      symbols.slice(index * MARKET_QUOTE_BATCH_SIZE, (index + 1) * MARKET_QUOTE_BATCH_SIZE));
    let running = false;
    async function refresh() {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const results = await Promise.allSettled(batches.map(async batch => {
          const response = await fetch("/api/market-quotes?tickers=" + encodeURIComponent(batch.join(",")), {
            cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(13_000)]),
          });
          if (!response.ok) throw new Error("Market quotes unavailable");
          return ((await response.json()) as { quotes: MarketQuotes }).quotes;
        }));
        if (controller.signal.aborted) return;
        const updates = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
        setQuotes(previous => Object.assign({}, previous, ...updates));
        setFailed(results.some(result => result.status === "rejected"));
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, MARKET_QUOTE_POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [key, refreshKey]);

  return { quotes, failed };
}
