import { NextRequest, NextResponse } from "next/server";
import { validateApiRequest } from "@/lib/request-schema";
import { authConfig, permitsRequestOrigin, SESSION_COOKIE, verifySession } from "@/lib/session";

const publicEndpoints = new Set(["/api/auth/login", "/api/auth/logout"]);

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/login") return NextResponse.next();

  const config = authConfig();
  if (!config) return NextResponse.json({ error: "登录服务尚未配置" }, { status: 503 });

  const isApi = pathname.startsWith("/api/");
  const authenticated = verifySession(req.cookies.get(SESSION_COOKIE)?.value, config);
  if (!authenticated && !publicEndpoints.has(pathname)) {
    const headers = { "Cache-Control": "private, no-store" };
    if (isApi) return NextResponse.json({ error: "需要登录" }, { status: 401, headers });
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return new NextResponse(null, { status: 303, headers: { ...headers, Location: login.pathname + login.search } });
  }

  if ((isApi || !["GET", "HEAD", "OPTIONS"].includes(req.method)) && !permitsRequestOrigin(req)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }
  if (!(await validateApiRequest(req))) {
    return NextResponse.json({ error: "输入参数无效或超过限制" }, { status: 422 });
  }
  return NextResponse.next({ headers: { "Cache-Control": "private, no-store" } });
}

export const config = { matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$).*)"] };
