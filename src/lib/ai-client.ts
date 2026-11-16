
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

export function getLlmConfigFromEnv(): Partial<LlmConfig> {
  return {
    baseUrl: process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || undefined,
    apiKey: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || undefined,
    model: process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || undefined,
  };
}

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

export function llmReady(db?: Partial<LlmConfig> | null): boolean {
  return resolveLlmConfig(db) !== null;
}

export function hasDeepSeekCredentials(): boolean {
  return !!process.env.DEEPSEEK_API_KEY || !!process.env.LLM_API_KEY;
}

export function sanitizeAiText(text: string): string {
  if (!text) return "";
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<img[^>]*onerror[^>]*>/gi, "")
    .trim();
}

export async function chatCompletion(opts: {
  config?: Partial<LlmConfig> | null;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDef[];
}): Promise<ChatResult | null> {
  const cfg = resolveLlmConfig(opts.config ?? null);
  if (!cfg) return null;

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
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
