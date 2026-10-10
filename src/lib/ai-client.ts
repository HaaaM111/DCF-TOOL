/**
 * OpenAI 兼容 LLM 客户端（通用）
 * ------------------------------------------------------------------
 * 支持任意 OpenAI 兼容端点：DeepSeek / Kimi / 通义 / 豆包 Ark(v3) / Ollama 等。
 * 配置来源（优先级）：环境变量 LLM_*  >  数据库 AppSetting（页面配置） > 默认值
 *   兼容旧变量：DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
 * 安全设计：
 *   1. API Key 绝不硬编码；返回给前端的任何响应都不回显明文 key
 *   2. 30 秒超时（AbortController）
 *   3. 返回文本做基础 XSS 过滤（去除 <script>、事件属性等）
 *   4. 未配置 Key 时 llmReady()=false / resolveLlmConfig()=null，调用方优雅降级
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
}

const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";

/** 从环境变量读取 LLM 配置（LLM_* 新名优先，兼容 DEEPSEEK_* 旧名） */
export function getLlmConfigFromEnv(): Partial<LlmConfig> {
  return {
    baseUrl: process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || undefined,
    apiKey: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || undefined,
    model: process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || undefined,
  };
}

/** 合并 env + DB 配置；缺少 apiKey 返回 null（未启用） */
export function resolveLlmConfig(db?: Partial<LlmConfig> | null): LlmConfig | null {
  const env = getLlmConfigFromEnv();
  const apiKey = env.apiKey || db?.apiKey || "";
  if (!apiKey) return null;
  return {
    baseUrl: (env.baseUrl || db?.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey,
    model: env.model || db?.model || DEFAULT_MODEL,
  };
}

/** 是否已启用 LLM（env 或 DB 任一配置了 key） */
export function llmReady(db?: Partial<LlmConfig> | null): boolean {
  return resolveLlmConfig(db) !== null;
}

/** 兼容旧调用：仅检查环境变量密钥 */
export function hasDeepSeekCredentials(): boolean {
  return !!process.env.DEEPSEEK_API_KEY || !!process.env.LLM_API_KEY;
}

/**
 * 基础 XSS 过滤：去除危险标签与事件属性
 * 入库前 + 渲染前双保险
 */
export function sanitizeAiText(text: string): string {
  if (!text) return "";
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "") // 移除 script 标签
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "") // 移除 iframe
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "") // 移除事件属性 onclick=...
    .replace(/on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "") // 移除 javascript: 协议
    .replace(/<img[^>]*onerror[^>]*>/gi, "") // 移除 onerror 图片
    .trim();
}

/**
 * 调用 OpenAI 兼容 Chat Completions（支持工具调用）
 * @param opts.config 额外配置（DB 兜底）；不传则只用环境变量
 * @param opts.messages 对话消息
 * @param opts.temperature 采样温度（默认 0.3）
 * @param opts.maxTokens 最大生成 token（默认 600）
 * @param opts.tools 工具定义（可选，传入后 tool_choice=auto）
 * @returns 解析结果；请求失败/超时返回 null
 */
export async function chatCompletion(opts: {
  config?: Partial<LlmConfig> | null;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDef[];
}): Promise<ChatResult | null> {
  const cfg = resolveLlmConfig(opts.config ?? null);
  if (!cfg) return null;

  // baseUrl 已含 /chat/completions 则直接使用，否则追加（兼容 DeepSeek 无 /v1、
  // Kimi/Ollama 带 /v1、豆包 Ark 用户填完整 chat/completions 三种情况）
  const endpoint = cfg.baseUrl.endsWith("/chat/completions")
    ? cfg.baseUrl
    : `${cfg.baseUrl}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 600,
    };
    if (opts.tools?.length) {
      body.tools = opts.tools;
      body.tool_choice = "auto";
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`LLM 请求失败: HTTP ${res.status} ${detail}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
    };

    const message = data.choices?.[0]?.message;
    return {
      content: message?.content ? sanitizeAiText(message.content) : null,
      toolCalls: message?.tool_calls ?? [],
    };
  } catch {
    return null; // 超时 / 网络 / 非 2xx 统一返回 null
  } finally {
    clearTimeout(timer);
  }
}

/** 兼容旧签名：双 prompt 对话（validation 路由使用） */
export async function chatWithDeepSeek(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  const result = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return result?.content ?? null;
}
