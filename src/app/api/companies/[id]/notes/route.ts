/**
 * GET  /api/companies/[id]/notes  —— 获取时间线记录
 * POST /api/companies/[id]/notes  —— 新增时间线记录（XSS 与长度校验）
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma, prismaBase } from "@/lib/prisma";
import { timelineEntrySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function companyIdParam(req: NextRequest) {
  // path: /api/companies/[id]/notes
  return req.nextUrl.pathname.split("/")[3];
}

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const companyId = companyIdParam(req);
  const notes = await prisma.timelineEntry.findMany({
    where: { companyId },
    orderBy: { date: "desc" },
  });
  return jsonOk({ notes });
}

export async function POST(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const companyId = companyIdParam(req);
  const exists = await prismaBase.company.findUnique({ where: { id: companyId } });
  if (!exists) return jsonError("标的不存在", 404, "NOT_FOUND");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("请求体不是合法的 JSON", 400, "INVALID_JSON");
  }

  const parsed = timelineEntrySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      `校验失败：${parsed.error.issues.map((i) => i.message).join("；")}`,
      422,
      "VALIDATION_ERROR",
    );
  }

  const note = await prisma.timelineEntry.create({
    data: {
      companyId,
      date: new Date(parsed.data.date),
      // 原样存储；前端以 React 文本节点渲染（{n.content}）时会自动转义，防 XSS 且显示原文
      content: parsed.data.content,
      tags: parsed.data.tags ?? "",
    },
  });

  return jsonOk({ note }, 201);
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
