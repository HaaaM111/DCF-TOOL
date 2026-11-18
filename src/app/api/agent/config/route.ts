import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { getLlmConfigFromEnv } from "@/lib/ai-client";
import { getAuthenticatedUserId } from "@/lib/auth";
import {
  readLlmDbSettings,
  writeLlmDbSettings,
  maskKey,
  configSource,
} from "@/lib/llm-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;

  const userId = getAuthenticatedUserId(req);
  const db = await readLlmDbSettings(userId);
  const env = getLlmConfigFromEnv();
  const source = configSource(db);
  const activeKey = source === "env" ? env.apiKey : source === "db" ? db.apiKey : "";

  return jsonOk({
    baseUrl: env.baseUrl || db.baseUrl || "",
    model: env.model || db.model || "",
    hasKey: !!activeKey,
    keyMasked: maskKey(activeKey),
    source,
  });
}

export async function POST(req: NextRequest) {
  const guard = await guardRequest(req);
  if (guard) return guard;

  let body: { baseUrl?: string; apiKey?: string; model?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("请求体必须是 JSON", 400, "BAD_BODY");
  }
  if (typeof body !== "object" || body === null) {
    return jsonError("请求体必须是 JSON 对象", 400, "BAD_BODY");
  }

  try {
    await writeLlmDbSettings({
      userId: getAuthenticatedUserId(req),
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      model: body.model,
    });
  } catch {
    return jsonError("保存配置失败", 500, "SETTINGS_SAVE_FAILED");
  }

  const db = await readLlmDbSettings(getAuthenticatedUserId(req));
  const env = getLlmConfigFromEnv();
  const source = configSource(db);
  const activeKey = source === "env" ? env.apiKey : source === "db" ? db.apiKey : "";

  return jsonOk({
    baseUrl: env.baseUrl || db.baseUrl || "",
    model: env.model || db.model || "",
    hasKey: !!activeKey,
    keyMasked: maskKey(activeKey),
    source,
  });
}

export async function OPTIONS(req: NextRequest) {
  return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
