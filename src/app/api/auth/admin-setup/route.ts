import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession, hashPassword, isSameOriginRequest, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(32).max(128), password: z.string().min(10).max(128) });

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`admin-setup:${getClientIp(req)}`, 5).allowed) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }
  if (!isSameOriginRequest(req, req.headers.get("origin"))) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "初始化链接无效或密码长度不足" }, { status: 400 });

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const user = await prisma.user.findFirst({
    where: { setupTokenHash: tokenHash, setupTokenExpiresAt: { gt: new Date() } },
    select: { id: true, email: true, role: true },
  });
  if (!user || user.role !== "admin") return NextResponse.json({ error: "初始化链接已失效，请联系管理员重新生成" }, { status: 410 });

  const updated = await prisma.user.updateMany({
    where: { id: user.id, setupTokenHash: tokenHash, setupTokenExpiresAt: { gt: new Date() } },
    data: { passwordHash: await hashPassword(parsed.data.password), setupTokenHash: null, setupTokenExpiresAt: null },
  });
  if (updated.count !== 1) return NextResponse.json({ error: "初始化链接已使用或失效" }, { status: 410 });

  const session = await createSession(user.id);
  const response = NextResponse.json({ user });
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return response;
}
