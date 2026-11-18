import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;

  const parts = req.nextUrl.pathname.split("/");
  const noteId = parts[parts.length - 1];
  const companyId = parts[3];
  const userId = getAuthenticatedUserId(req);

  const note = await prisma.timelineEntry.findFirst({ where: { id: noteId, companyId } });
  const company = await prisma.company.findFirst({ where: { id: companyId, userId }, select: { id: true } });
  if (!note || !company) {
    return jsonError("记录不存在", 404, "NOT_FOUND");
  }

  await prisma.timelineEntry.delete({ where: { id: noteId } });
  return jsonOk({ success: true });
}

export async function OPTIONS(req: NextRequest) {
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
