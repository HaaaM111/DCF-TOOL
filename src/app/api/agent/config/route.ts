import { configSchema } from "@/lib/agent/schemas";
import { validateRemoteUrl } from "@/lib/security/urls";
/**
 * GET/POST /api/agent/config —— 智能体 LLM 配置读写
 * ------------------------------------------------------------------
 * GET：返回配置状态（baseUrl/model/是否已启用/来源/掩码 key），不回显明文 key
 * POST：写入 AppSetting（服务端存储）；空字符串删除对应项
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { getLlmConfigFromEnv } from "@/lib/ai-client";
import {
  readLlmDbSettings,
  writeLlmDbSettings,
  maskKey,
  configSource,
} from "@/lib/llm-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  const db = await readLlmDbSettings();
  const env = getLlmConfigFromEnv();
  const source = configSource(db);
  const activeKey = source === "env" ? env.apiKey : source === "db" ? db.apiKey : "";

  return jsonOk({
    baseUrl: env.baseUrl || db.baseUrl || "",
    model: env.model || db.model || "",
    thinking: env.thinking || db.thinking || "",
    hasKey: !!activeKey,
    keyMasked: maskKey(activeKey),
    source,
  });
}

export async function POST(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  let body: { baseUrl?: string; apiKey?: string; model?: string; thinking?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("请求体必须是 JSON", 400, "BAD_BODY");
  }
  if (typeof body !== "object" || body === null) {
    return jsonError("请求体必须是 JSON 对象", 400, "BAD_BODY");
  }

  const parsed = configSchema.safeParse(body);
  if (!parsed.success) return jsonError("配置参数无效", 422, "VALIDATION_ERROR");
  body = parsed.data;
  try { if (body.baseUrl) validateRemoteUrl(body.baseUrl); } catch { return jsonError("不受信任的服务地址",422,"INVALID_ENDPOINT"); }
  const previous = await readLlmDbSettings();
  if (body.baseUrl && body.baseUrl !== previous.baseUrl && !body.apiKey) return jsonError("更换端点必须重新提供该端点的密钥",422,"KEY_BINDING_REQUIRED");
  try {
    await writeLlmDbSettings({
      baseUrl: body.baseUrl ?? previous.baseUrl,
      apiKey: body.apiKey ?? previous.apiKey,
      model: body.model ?? previous.model,
      thinking: body.thinking ?? previous.thinking,
    });
  } catch {
    return jsonError("保存配置失败", 500, "SETTINGS_SAVE_FAILED");
  }

  const db = await readLlmDbSettings();
  const env = getLlmConfigFromEnv();
  const source = configSource(db);
  const activeKey = source === "env" ? env.apiKey : source === "db" ? db.apiKey : "";

  return jsonOk({
    baseUrl: env.baseUrl || db.baseUrl || "",
    model: env.model || db.model || "",
    thinking: env.thinking || db.thinking || "",
    hasKey: !!activeKey,
    keyMasked: maskKey(activeKey),
    source,
  });
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
