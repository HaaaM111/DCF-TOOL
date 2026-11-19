import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { companyAccessWhere, getAuthenticatedUserId } from "@/lib/auth";
import { timelineEntrySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function companyIdParam(req: NextRequest) {
  return req.nextUrl.pathname.split("/")[3];
}

export async function GET(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;

  const companyId = companyIdParam(req);
  const userId = getAuthenticatedUserId(req);
  const owned = await prisma.company.findFirst({ where: companyAccessWhere(req, companyId), select: { id: true } });
  if (!owned) return jsonError("标的不存在", 404, "NOT_FOUND");
  const notes = await prisma.timelineEntry.findMany({
    where: { companyId },
    orderBy: { date: "desc" },
  });
  return jsonOk({ notes });
}

export async function POST(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;

  const companyId = companyIdParam(req);
  const userId = getAuthenticatedUserId(req);
  const exists = await prisma.company.findFirst({ where: companyAccessWhere(req, companyId), select: { id: true } });
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
      content: parsed.data.content,
      tags: parsed.data.tags ?? "",
    },
  });

  return jsonOk({ note }, 201);
}

export async function OPTIONS(req: NextRequest) {
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
