import type { NextRequest } from "next/server";
import { z } from "zod";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { idSchema } from "@/lib/agent/schemas";
import { getOperatingPublication, getOperatingRevision, publishOperatingModel } from "@/lib/operating-model-store";
import { operatingAnalysisSchema } from "@/lib/operating-scenarios";

type Context = { params: Promise<{ id: string }> };
const publishSchema = z.strictObject({
  input: operatingAnalysisSchema,
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});

export async function GET(req: NextRequest, context: Context) {
  const guard = guardRequest(req);
  if (guard) return guard;
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return jsonError("公司编号无效", 422);
  const publication = await getOperatingPublication(id.data);
  if (!publication) return jsonError("暂无已发布底稿", 404);
  const input = await getOperatingRevision(id.data, publication.revision);
  return input ? jsonOk({ publication, input }) : jsonError("已发布底稿不可用", 409);
}

export async function POST(req: NextRequest, context: Context) {
  const guard = guardRequest(req);
  if (guard) return guard;
  const id = idSchema.safeParse((await context.params).id);
  const parsed = publishSchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !parsed.success) return jsonError("公司编号或经营估值输入无效", 422);
  const result = await publishOperatingModel(id.data, parsed.data.input, parsed.data.expectedRevision);
  if ("error" in result) {
    if (result.error === "conflict") return jsonError("主估值已更新，请重新加载当前底稿", 409);
    return result.error === "not_found" ? jsonError("标的不存在", 404) : jsonError("请核对证券代码及三模型勾稽", 422);
  }
  return jsonOk(result);
}
