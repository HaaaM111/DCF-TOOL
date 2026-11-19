import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "./rate-limit";
import { attachAuthenticatedUser, getSessionUser } from "./auth";

function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function applyCors(res: NextResponse, origin?: string): NextResponse {
  const allowed = getAllowedOrigins();
  if (origin && (allowed.includes(origin) || allowed.includes("*"))) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With",
  );
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

export function handleCorsPreflight(req: NextRequest): NextResponse | null {
  if (req.method === "OPTIONS") {
    return applyCors(new NextResponse(null, { status: 204 }), req.headers.get("origin") ?? undefined);
  }
  return null;
}

export function rateLimitGuard(req: NextRequest): NextResponse | null {
  const ip = getClientIp(req);
  const limit = parseInt(process.env.RATE_LIMIT_PER_MINUTE ?? "60", 10);
  const { allowed, resetAt } = checkRateLimit(ip, limit);
  if (!allowed) {
    const res = NextResponse.json(
      { error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" },
      { status: 429 },
    );
    res.headers.set("X-RateLimit-Limit", String(limit));
    res.headers.set("X-RateLimit-Remaining", "0");
    res.headers.set("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
    return applyCors(res, req.headers.get("origin") ?? undefined);
  }
  return null;
}

export function jsonError(
  message: string,
  status = 400,
  code = "BAD_REQUEST",
): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export async function guardRequest(req: NextRequest): Promise<NextResponse | null> {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const rateLimit = rateLimitGuard(req);
  if (rateLimit) return rateLimit;
  const user = await getSessionUser(req);
  if (!user) return jsonError("请先登录后继续", 401, "UNAUTHENTICATED");
  attachAuthenticatedUser(req, user);
  return null;
}
