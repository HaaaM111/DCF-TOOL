import { NextRequest, NextResponse } from "next/server";
import { createSession, isSameOriginRequest, SESSION_COOKIE, sessionCookieOptions, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`signin:${getClientIp(req)}`, 12).allowed) {
    return NextResponse.json({ error: "登录尝试过于频繁，请稍后再试" }, { status: 429 });
  }
  if (!isSameOriginRequest(req, req.headers.get("origin"))) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const body = await req.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password || email.length > 254 || password.length > 128) {
    return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });

  const session = await createSession(user.id);
  const response = NextResponse.json({ user: { id: user.id, email: user.email, role: user.role } });
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return response;
}
