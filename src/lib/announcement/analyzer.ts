/**
 * 公告信号分析模块（LLM 部分）
 * ------------------------------------------------------------------
 * 复用 src/lib/ai-client.ts（OpenAI 兼容，支持 DeepSeek/Kimi/豆包等）。
 * 配置来源：调用方可传入 DB 配置（env 优先在 resolveLlmConfig 内部处理）。
 * 未配置 key 时：llmReady(config)=false，analyzeAnnouncement 直接返回 null，
 * 调用方降级为"不产生信号"，不报错、不影响其他功能。
 * 配置 key 后自动激活，无需改代码。
 */
import {
  chatCompletion,
  resolveLlmConfig,
  type LlmConfig,
} from "@/lib/ai-client";

export interface SuggestedChange {
  field: string; // 限定 Assumption 字段
  action: "上调" | "下调" | "维持";
  from?: number;
  to?: number;
  reason: string;
}

export interface SignalResult {
  expectation: "超预期" | "符合预期" | "低于预期" | "无法判断";
  direction: "positive" | "neutral" | "negative";
  summary: string;
  evidence: string[]; // 逐字引用原文
  suggestedChanges: SuggestedChange[];
}

/** suggestedChanges.field 白名单（对应 prisma.Assumption 字段） */
export const ALLOWED_ASSUMPTION_FIELDS = [
  "baseFcf",
  "g1",
  "g2",
  "g3",
  "perpetualG",
  "ke",
  "wacc",
  "e1",
  "e2",
  "e3",
  "exitPe",
  "transitionG",
  "terminalProfitEst",
] as const;

const SYSTEM_PROMPT = `你是A股价值投资者的公告分析助手。你的任务：基于公告原文和公司当前DCF假设，判断公告对预期的影响，并给出假设修正建议。
硬性规则：
1. 只依据公告原文内容，不得引入外部信息或猜测。
2. evidence 必须逐字引用公告原文句子，禁止改写或编造；没有原文依据的数字一律不写。
3. 无法判断时 expectation="无法判断"，suggestedChanges 为空数组。
4. suggestedChanges[].field 只能是：${ALLOWED_ASSUMPTION_FIELDS.join(", ")}。
5. action 只能是"上调/下调/维持"；from/to 与公告数据一致，缺失则省略。
6. 只输出 JSON，不要任何解释文字。`;

/**
 * LLM 是否已配置可用（env 优先，DB 兜底）。
 * @param config DB 兜底配置（页面设置的 key 等），不传则只认环境变量
 */
export function llmReady(config?: Partial<LlmConfig> | null): boolean {
  return resolveLlmConfig(config ?? null) !== null;
}

/**
 * 生成预期差信号；未配置 key / 解析失败 / 超时返回 null（调用方降级）
 * @param config DB 兜底配置；不传则只认环境变量
 */
export async function analyzeAnnouncement(
  title: string,
  text: string,
  assumptions: Record<string, number>,
  config?: Partial<LlmConfig> | null,
): Promise<SignalResult | null> {
  if (!llmReady(config)) return null;

  const userPrompt = `【公告标题】${title}\n【公告正文】${text}\n【公司当前DCF假设】${JSON.stringify(
    assumptions,
  )}\n请输出JSON：{"expectation","direction","summary","evidence":[],"suggestedChanges":[{"field","action","from","to","reason"}]}`;

  const result = await chatCompletion({
    config: config ?? null,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  const raw = result?.content;
  if (!raw) return null;

  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as SignalResult;
    // 字段白名单过滤，防止 LLM 输出非法字段
    if (Array.isArray(parsed.suggestedChanges)) {
      parsed.suggestedChanges = parsed.suggestedChanges.filter(
        (c) =>
          c &&
          typeof c.field === "string" &&
          (ALLOWED_ASSUMPTION_FIELDS as readonly string[]).includes(c.field) &&
          ["上调", "下调", "维持"].includes(c.action),
      );
    }
    return parsed;
  } catch {
    return null; // JSON 解析失败：不产生信号
  }
}
