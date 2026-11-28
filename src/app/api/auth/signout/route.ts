import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req, req.headers.get("origin"))) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const { createHash } = await import("node:crypto");
    await prisma.session.deleteMany({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: new Date(0) });
  return response;
}
