import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { authConfig, createSession, credentialsMatch, loginSchema, permitsRequestOrigin, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  const config = authConfig();
  if (!config) return NextResponse.json({ error: "登录服务尚未配置" }, { status: 503, headers });
  if (!permitsRequestOrigin(req)) return NextResponse.json({ error: "请求来源无效" }, { status: 403, headers });
  const limit = checkRateLimit("auth:login", 20);
  if (!limit.allowed) {
    return NextResponse.json({ error: "尝试次数过多，请稍后重试" }, {
      status: 429, headers: { ...headers, "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
    });
  }
  const input = loginSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "请检查账号和密码输入" }, { status: 422, headers });
  if (!credentialsMatch(config, input.data.username, input.data.password)) {
    return NextResponse.json({ error: "账号或密码错误" }, { status: 401, headers });
  }
  const response = NextResponse.json({ ok: true }, { headers });
  response.cookies.set(SESSION_COOKIE, createSession(config), sessionCookieOptions);
  return response;
}
