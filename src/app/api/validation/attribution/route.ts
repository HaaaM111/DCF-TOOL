import { NextRequest } from "next/server";
import { z } from "zod";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { companyAccessWhere } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { idSchema } from "@/lib/agent/schemas";
import { chatCompletion, llmReady, llmTimeoutMs, SERVICE_UNAVAILABLE } from "@/lib/ai-client";
import { readLlmDbSettings } from "@/lib/llm-settings";
import { loadAttributionEvidence } from "@/lib/valuation-attribution-service";
import { attributionModelContext, attributionPrompt, availableAttributionTopics, parseAttributionAnalysis } from "@/lib/valuation-attribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await guardRequest(request);
  if (guard) return guard;
  const parsed = idSchema.safeParse(request.nextUrl.searchParams.get("companyId"));
  if (!parsed.success) return jsonError("标的参数无效", 422);
  if (!await prisma.company.findFirst({ where: companyAccessWhere(request, parsed.data), select: { id: true } })) return jsonError("标的不存在", 404);
  try {
    const [evidence, config] = await Promise.all([loadAttributionEvidence(parsed.data), readLlmDbSettings().catch(() => null)]);
    if (!evidence) return jsonError("标的不存在", 404);
    return jsonOk({ evidence, configured: llmReady(config) });
  } catch {
    return jsonError("无法读取已发布估值证据，请稍后重试", 503);
  }
}

const inputSchema = z.strictObject({ companyId: idSchema });

export async function POST(request: NextRequest) {
  const guard = await guardRequest(request);
  if (guard) return guard;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("标的参数无效", 422);
  if (!await prisma.company.findFirst({ where: companyAccessWhere(request, parsed.data.companyId), select: { id: true } })) return jsonError("标的不存在", 404);
  try {
    const [evidence, config] = await Promise.all([loadAttributionEvidence(parsed.data.companyId), readLlmDbSettings()]);
    if (!evidence) return jsonError("标的不存在", 404);
    if (!llmReady(config)) return jsonError(SERVICE_UNAVAILABLE, 503, "LLM_UNCONFIGURED");
    const topics = availableAttributionTopics(evidence);
    if (!topics.length) return jsonError("现有证据不足，先核验估值底稿或补齐同行、公告资料", 422, "INSUFFICIENT_EVIDENCE");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(llmTimeoutMs())]);
    const context = JSON.stringify(attributionModelContext(evidence));
    const generate = async (retry = false) => {
      const result = await chatCompletion({
        config, maxTokens: retry ? 450 : 800, temperature: 0.1, signal,
        messages: [
          { role: "system", content: retry ? attributionPrompt + "\n仅输出一项有证据的模型驱动及一个核验项，严格遵循 JSON 格式。" : attributionPrompt },
          { role: "user", content: context },
        ],
      });
      return result?.content ? parseAttributionAnalysis(result.content, topics, evidence.comparison.mode !== "aligned", evidence.model?.kind) : null;
    };
    const analysis = await generate() ?? (signal.aborted ? null : await generate(true));
    if (!analysis) return jsonError(SERVICE_UNAVAILABLE, 503);
    return jsonOk({ evidence, analysis, aiAttribution: [...analysis.drivers.map((driver) => driver.explanation), analysis.check].join("\n") });
  } catch {
    return jsonError(SERVICE_UNAVAILABLE, 503);
  }
}
