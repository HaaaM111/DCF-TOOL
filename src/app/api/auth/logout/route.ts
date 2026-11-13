import { NextRequest, NextResponse } from "next/server";
import { permitsRequestOrigin, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export async function POST(req: NextRequest) {
  if (!permitsRequestOrigin(req)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
