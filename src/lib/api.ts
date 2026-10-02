/**
 * API 通用工具：CORS、速率限制、统一响应格式
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "./rate-limit";

/** 从环境变量读取 CORS 白名单 */
function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** 应用 CORS 头到响应 */
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

/** 处理 OPTIONS 预检请求 */
export function handleCorsPreflight(req: NextRequest): NextResponse | null {
  if (req.method === "OPTIONS") {
    return applyCors(new NextResponse(null, { status: 204 }), req.headers.get("origin") ?? undefined);
  }
  return null;
}

/** 速率限制守卫；超限返回 429 */
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

/** 统一错误响应 */
export function jsonError(
  message: string,
  status = 400,
  code = "BAD_REQUEST",
): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

/** 统一成功响应 */
export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** 读取并限流的统一入口（在每个路由开头调用） */
export function guardRequest(req: NextRequest): NextResponse | null {
  return handleCorsPreflight(req) ?? rateLimitGuard(req);
}
