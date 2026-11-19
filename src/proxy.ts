import { NextRequest, NextResponse } from "next/server";
import { validateApiRequest } from "@/lib/request-schema";

/**
 * 统一入口守卫（Next 16 的 proxy 即原 middleware）。
 * 保留上游的 zod 输入门禁与同源校验；鉴权改为本站的会话 Cookie（vi_session）多用户登录。
 */
const SESSION_COOKIE = "vi_session";

/** 免登录页面 */
const PUBLIC_PAGES = new Set(["/", "/sign-in", "/sign-up", "/admin-setup"]);

/** 免登录接口（登录、注册、登出、会话探测、首位管理员初始化） */
const PUBLIC_APIS = new Set([
  "/api/auth/signin",
  "/api/auth/signup",
  "/api/auth/signout",
  "/api/auth/me",
  "/api/auth/admin-setup",
]);

function allowedOrigins(req: NextRequest): string[] {
  return [
    req.nextUrl.origin,
    ...(process.env.CORS_ORIGIN || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) 输入门禁：路径段、query、请求体结构与体积（上游 request-schema）
  if (!(await validateApiRequest(req))) {
    return NextResponse.json({ error: "输入参数无效或超过限制" }, { status: 422 });
  }

  // 2) 接口鉴权
  if (pathname.startsWith("/api/")) {
    if (PUBLIC_APIS.has(pathname)) return NextResponse.next();
    const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
    if (!hasSession) {
      return NextResponse.json(
        { error: "请先登录后继续", code: "UNAUTHENTICATED" },
        { status: 401 },
      );
    }
    // 写操作同源校验，降低 CSRF 风险
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.get("origin");
      if (origin && !allowedOrigins(req).includes(origin)) {
        return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
      }
    }
    return NextResponse.next();
  }

  // 3) 页面路由：无会话跳登录页
  if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();
  if (!req.cookies.get(SESSION_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
