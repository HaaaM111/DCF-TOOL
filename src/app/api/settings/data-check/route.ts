import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { resolveFinancials, resolveQuote } from "@/lib/data-source";
import { isEastMoneyEnabled } from "@/lib/eastmoney-client";
import { hasIfindCredentials } from "@/lib/ifind-client";
import { getOperatingPublication, getOperatingRevision } from "@/lib/operating-model-store";
import { calculateOperatingValuation } from "@/lib/operating-valuation";
import { prisma } from "@/lib/prisma";
import { tickerSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyPublishedModel(ticker: string) {
  const company = await prisma.company.findUnique({ where: { ticker }, select: { id: true } });
  if (!company) return null;
  const publication = await getOperatingPublication(company.id);
  if (!publication) return null;
  const input = await getOperatingRevision(company.id, publication.revision);
  if (!input) return { publication, result: null };
  const result = calculateOperatingValuation(input);
  return {
    publication, result: { prices: result.prices, reconciliation: result.reconciliation,
      priceMatches: Math.abs(result.prices.reoi - publication.price) <= result.reconciliation.tolerance,
      terminalValueShare: result.terminal.operatingValueShare, spread: input.wacc - input.terminalGrowth },
  };
}

export async function GET(request: NextRequest) {
  const guard = guardRequest(request);
  if (guard) return guard;
  const providers = { ifind: hasIfindCredentials(), eastmoney: isEastMoneyEnabled() };
  const input = request.nextUrl.searchParams.get("ticker");
  if (input === null) return jsonOk({ providers });
  const parsed = tickerSchema.safeParse(input.trim().toUpperCase());
  if (!parsed.success) return jsonError("请输入有效的股票代码", 422, "INVALID_TICKER");
  const ticker = parsed.data;
  const [quoteResult, financialResult, valuationResult] = await Promise.allSettled([
    resolveQuote(ticker), resolveFinancials(ticker), verifyPublishedModel(ticker),
  ]);
  const quote = quoteResult.status === "fulfilled" && quoteResult.value.source !== "mock" ? quoteResult.value : null;
  const finance = financialResult.status === "fulfilled" && financialResult.value.source !== "mock" ? financialResult.value : null;
  return jsonOk({
    ticker, providers, checkedAt: new Date().toISOString(),
    quote: quote ? { source: quote.source, date: quote.data.date, price: quote.data.close, kind: quote.data.kind } : null,
    finance: finance ? { source: finance.source, periodEnd: finance.data.reportDate,
      cashSource: finance.data.cashSource ?? null, missingFields: finance.data.missingFields ?? [],
      cashFlowVerified: finance.data.reportedCashFlow?.cfo != null && finance.data.reportedCashFlow?.capex != null
        && finance.data.reportedCashFlow.capex >= 0 } : null,
    valuation: valuationResult.status === "fulfilled" ? valuationResult.value : null,
    valuationError: valuationResult.status === "rejected",
  });
}
