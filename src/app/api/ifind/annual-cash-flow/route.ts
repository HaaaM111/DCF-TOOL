import type { NextRequest } from "next/server";
import { z } from "zod";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { resolveAnnualCashFlow } from "@/lib/data-source";

const tickerSchema = z.string().trim().toUpperCase().regex(/^\d{6}\.(SH|SZ)$/);

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;
  const ticker = tickerSchema.safeParse(req.nextUrl.searchParams.get("ticker"));
  if (!ticker.success) return jsonError("仅支持沪深标的的 CNY 年报现金流", 422);
  return jsonOk({ ticker: ticker.data, currency: "CNY", ...await resolveAnnualCashFlow(ticker.data) });
}
