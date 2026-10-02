/**
 * DELETE /api/companies/[id]/notes/[noteId] —— 删除一条时间线记录
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  // path: /api/companies/[id]/notes/[noteId]
  const parts = req.nextUrl.pathname.split("/");
  const noteId = parts[parts.length - 1];
  const companyId = parts[3];

  const note = await prisma.timelineEntry.findUnique({ where: { id: noteId } });
  if (!note || note.companyId !== companyId) {
    return jsonError("记录不存在", 404, "NOT_FOUND");
  }

  await prisma.timelineEntry.delete({ where: { id: noteId } });
  return jsonOk({ success: true });
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
