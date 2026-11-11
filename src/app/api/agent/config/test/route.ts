import { configSchema } from "@/lib/agent/schemas";
import { validateRemoteUrl } from "@/lib/security/urls";
/**
 * POST /api/agent/config/test —— LLM 连通性诊断
 * ------------------------------------------------------------------
 * 目的：把「超时 / 网络错误」这类模糊报错变成可定位的结论。
 * 用当前配置（或本次提交的临时配置）发一次最小请求，返回：
 *   ok / 耗时 ms / 模型回复片段，或失败的具体原因（超时、DNS、401、404…）。
 * 不写库；body 中的 apiKey 为空时回退到数据库/环境变量已存配置。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { chatCompletion, resolveLlmConfig } from "@/lib/ai-client";
import { readLlmDbSettings } from "@/lib/llm-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  let body: { baseUrl?: string; apiKey?: string; model?: string; thinking?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // 允许空 body：用已保存配置测试
  }

  const parsed = configSchema.safeParse(body);
  if (!parsed.success) return jsonError("配置参数无效", 422, "VALIDATION_ERROR");
  body = parsed.data;
  try { if (body.baseUrl) validateRemoteUrl(body.baseUrl); } catch { return jsonError("不受信任的服务地址",422,"INVALID_ENDPOINT"); }
  const previous = await readLlmDbSettings();
  if (body.baseUrl && body.baseUrl !== previous.baseUrl && !body.apiKey) return jsonError("更换端点必须重新提供该端点的密钥",422,"KEY_BINDING_REQUIRED");
  const dbCfg = await readLlmDbSettings();
  // 本次提交的配置优先（apiKey 留空表示沿用已存 key）
  const merged = {
    baseUrl: body.baseUrl?.trim() || dbCfg.baseUrl,
    apiKey: body.apiKey?.trim() || dbCfg.apiKey,
    model: body.model?.trim() || dbCfg.model,
    thinking: (body.thinking?.trim() || dbCfg.thinking) as
      | "disabled"
      | "auto"
      | "enabled"
      | undefined,
  };

  const cfg = resolveLlmConfig(merged);
  if (!cfg) {
    return jsonOk({
      ok: false,
      error: "未检测到 API Key：请在「API 配置」填写 API Key，或先保存配置后再测试。",
    });
  }

  const startedAt = Date.now();
  try {
    const result = await chatCompletion({
      config: merged,
      messages: [{ role: "user", content: "回复两个字：可用" }],
      temperature: 0,
      maxTokens: 50,
    });
    const elapsedMs = Date.now() - startedAt;

    if (!result?.content) {
      return jsonOk({
        ok: false,
        elapsedMs,
        model: cfg.model,
        thinking: cfg.thinking ?? "未设置",
        error:
          "接口连通但模型未返回正文：多为深度思考模式吞掉了输出，请在「API 配置」把思考模式设为 disabled 后重试。",
      });
    }

    return jsonOk({
      ok: true,
      elapsedMs,
      model: cfg.model,
      thinking: cfg.thinking ?? "未设置",
      sample: result.content.slice(0, 60),
    });
  } catch (e) {
    return jsonOk({
      ok: false,
      elapsedMs: Date.now() - startedAt,
      model: cfg.model,
      thinking: cfg.thinking ?? "未设置",
      error: "分析服务暂时不可用，请稍后重试",
    });
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
