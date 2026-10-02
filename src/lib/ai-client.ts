/**
 * DeepSeek AI 客户端
 * ------------------------------------------------------------------
 * 安全设计：
 *   1. API Key 仅从 process.env.DEEPSEEK_API_KEY 读取，绝不硬编码
 *   2. 30 秒超时（AbortController），避免阻塞
 *   3. 返回文本做基础 XSS 过滤（去除 <script>、事件属性等）
 *   4. 未配置 Key 时返回 null，调用方优雅降级
 */

const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const REQUEST_TIMEOUT_MS = 30000;

/** 是否配置了 DeepSeek 密钥 */
export function hasDeepSeekCredentials(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
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
 * 调用 DeepSeek Chat Completions
 * @param systemPrompt 系统角色提示
 * @param userPrompt 用户提示
 * @returns AI 生成的文本（已 XSS 过滤），失败返回 null
 */
export async function chatWithDeepSeek(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 600,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`DeepSeek 请求失败: HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    return sanitizeAiText(content);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return null; // 超时
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
