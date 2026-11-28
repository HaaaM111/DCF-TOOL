import { NextRequest } from "next/server";
import { z } from "zod";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { MARKET_QUOTE_BATCH_SIZE } from "@/lib/market-quote";
import { loadMarketQuotes } from "@/lib/market-quote-service";
import { tickerSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const batchSchema = z.string().max(MARKET_QUOTE_BATCH_SIZE * 21)
  .transform(value => value.split(","))
  .pipe(z.array(tickerSchema).min(1).max(MARKET_QUOTE_BATCH_SIZE));

export async function GET(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;
  const request = batchSchema.safeParse(req.nextUrl.searchParams.get("tickers"));
  if (!request.success) return jsonError("标的代码无效或超出批量查询上限", 422, "INVALID_TICKERS");
  const tickers = [...new Set(request.data.map(ticker => ticker.toUpperCase()))];
  const response = jsonOk({ quotes: await loadMarketQuotes(tickers) });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
