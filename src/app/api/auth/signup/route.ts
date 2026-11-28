import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSession, hashPassword, isSameOriginRequest, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { prisma, prismaBase } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
});

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`signup:${getClientIp(req)}`, 6).allowed) {
    return NextResponse.json({ error: "注册请求过于频繁，请稍后再试" }, { status: 429 });
  }
  if (!isSameOriginRequest(req, req.headers.get("origin"))) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请输入有效邮箱和至少 10 位密码" }, { status: 400 });

  const email = parsed.data.email.toLowerCase();
  try {
    const baseCompanies = await prismaBase.company.findMany();
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { email, passwordHash } });
      const seed = baseCompanies.map((company) => {
        const { id, createdAt, updatedAt, ...fields } = company;
        void id;
        void createdAt;
        void updatedAt;
        return { ...fields, id: randomUUID(), userId: created.id };
      });
      if (seed.length) await tx.company.createMany({ data: seed });
      return created;
    });
    const session = await createSession(user.id);
    const response = NextResponse.json({ user: { id: user.id, email: user.email } }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "这个邮箱已经注册，请直接登录" }, { status: 409 });
    }
    console.error("[auth/signup] registration failed", error);
    return NextResponse.json({ error: "注册暂时失败，请稍后重试" }, { status: 500 });
  }
}
