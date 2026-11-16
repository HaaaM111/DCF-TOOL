import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { resolveQuote } from "@/lib/data-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const ticker = req.nextUrl.searchParams.get("ticker")?.trim() ?? "";
  if (!ticker) {
    return jsonError("缺少 ticker 参数", 400, "MISSING_TICKER");
  }

  try {
    const { data, source } = await resolveQuote(ticker);
    return jsonOk({ data, source, mock: source === "mock" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "行情获取失败";
    return jsonError(msg, 502, "QUOTE_ERROR");
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
