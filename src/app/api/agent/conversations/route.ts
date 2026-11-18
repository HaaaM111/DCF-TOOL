import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { sanitizeAiText } from "@/lib/ai-client";
import { getAuthenticatedUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONTENT_CHARS = 4000;
const MAX_READ = 200;
const MAX_WRITE_PER_CALL = 20;

interface ConvMsg {
  role: "user" | "assistant";
  content: string;
}

export async function GET(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;

  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return jsonError("缺少 companyId", 400, "BAD_BODY");
  }
  const owned = await prisma.company.findFirst({ where: { id: companyId, userId: getAuthenticatedUserId(req) }, select: { id: true } });
  if (!owned) return jsonError("标的不存在", 404, "NOT_FOUND");

  try {
    const rows = await prisma.agentConversation.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
      take: MAX_READ,
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return jsonOk({ items: rows });
  } catch (e) {
    return jsonError(
      `读取对话记录失败：${e instanceof Error ? e.message : "未知错误"}`,
      500,
      "CONV_READ_FAILED",
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;

  let body: { companyId?: string; messages?: ConvMsg[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("请求体必须是 JSON", 400, "BAD_BODY");
  }
  const companyId = body?.companyId;
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!companyId || !messages.length) {
    return jsonError("缺少 companyId 或 messages", 400, "BAD_BODY");
  }
  const owned = await prisma.company.findFirst({ where: { id: companyId, userId: getAuthenticatedUserId(req) }, select: { id: true } });
  if (!owned) return jsonError("标的不存在", 404, "NOT_FOUND");

  const cleaned = messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    )
    .slice(-MAX_WRITE_PER_CALL)
    .map((m) => ({
      companyId,
      role: m.role,
      content: sanitizeAiText(m.content.slice(0, MAX_CONTENT_CHARS)),
    }));
  if (!cleaned.length) {
    return jsonError("没有可写入的消息", 400, "BAD_BODY");
  }

  try {
    await prisma.agentConversation.createMany({ data: cleaned });
    return jsonOk({ ok: true, count: cleaned.length });
  } catch (e) {
    return jsonError(
      `写入对话记录失败：${e instanceof Error ? e.message : "未知错误"}`,
      500,
      "CONV_WRITE_FAILED",
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
