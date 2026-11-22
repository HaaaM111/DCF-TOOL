import type { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { idSchema } from "@/lib/agent/schemas";
import { analyzeOperatingModel, operatingSimulationReport } from "@/lib/operating-model-input";
import { getOperatingPublication, getOperatingRevision } from "@/lib/operating-model-store";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const guard = guardRequest(request);
  if (guard) return guard;
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return jsonError("标的参数无效", 422);

  try {
    const publication = await getOperatingPublication(id.data);
    if (!publication) return jsonError("暂无已发布经营底稿", 404);
    const input = await getOperatingRevision(id.data, publication.revision);
    if (!input) return jsonError("已发布底稿不可用", 409);
    const simulation = input.scenarios?.simulation ? operatingSimulationReport(analyzeOperatingModel(input, false).simulation) : null;
    const response = jsonOk({ revision: publication.revision, currency: publication.currency, simulation });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return jsonError("读取经营估值模拟失败，请稍后重试", 503);
  }
}
