/**
 * POST /api/agent/chat —— 智能体对话主入口
 * ------------------------------------------------------------------
 * 能力：固定绑定某标的；系统上下文 = 该公司 DCF 假设 + 近期公告信号；
 *      工具 sync_announcements：用户要求拉取/更新公告时由模型调用，
 *      执行真实同步（复用 sync-service），结果回传模型后给出最终回答。
 * 降级：未配置 LLM API（env/DB 均无 key）→ 返回 llmReady:false + 引导文案，不报错。
 * 安全：reply 经 XSS 过滤；key 仅服务端；工具循环最多 1 轮防死循环。
 */
import { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  chatCompletion,
  resolveLlmConfig,
  type ChatMessage,
  type ToolDef,
} from "@/lib/ai-client";
import { readLlmDbSettings } from "@/lib/llm-settings";
import { syncCompanyAnnouncements } from "@/lib/announcement/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HISTORY = 20; // 发送给模型的历史消息条数上限
const MAX_MSG_CHARS = 4000; // 单条消息截断
const MAX_TOKENS = 900;

const SYNC_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "sync_announcements",
    description:
      "重新拉取当前标的最近 N 天（1-90，默认 30）的公告并分析，返回新增公告与预期差信号情况。当用户要求拉取、更新、重新同步公告时调用。",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          description: "拉取最近多少天的公告，不传默认 30",
        },
      },
    },
  },
};

interface ClientMsg {
  role: "user" | "assistant";
  content: string;
}

/** 组装系统提示：角色 + 当前标的 DCF 假设 + 近期公告信号 */
async function buildSystemPrompt(
  companyId: string,
  company: { name: string; ticker: string },
): Promise<string> {
  const [assumptions, announcements] = await Promise.all([
    prisma.assumption.findUnique({ where: { companyId } }),
    prisma.announcement.findMany({
      where: { companyId },
      orderBy: { publishAt: "desc" },
      take: 10,
      include: { signals: true },
    }),
  ]);

  const assumptionLines = assumptions
    ? Object.entries({
        baseFcf: assumptions.baseFcf,
        g1: assumptions.g1,
        g2: assumptions.g2,
        g3: assumptions.g3,
        perpetualG: assumptions.perpetualG,
        ke: assumptions.ke,
        wacc: assumptions.wacc,
        e1: assumptions.e1,
        e2: assumptions.e2,
        e3: assumptions.e3,
        exitPe: assumptions.exitPe,
        transitionG: assumptions.transitionG,
        terminalProfitEst: assumptions.terminalProfitEst,
      })
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
    : "（无已保存假设）";

  const annLines = announcements.length
    ? announcements
        .map((a) => {
          const s = a.signals[0];
          const head = `${a.publishAt.toISOString().slice(0, 10)} ${a.title} [${a.category}]`;
          if (!s) return head + "（未产生信号）";
          const changes = (s.suggestedChanges as { field: string; action: string; from?: number; to?: number; reason?: string }[] | null) ?? [];
          const chg = changes.length
            ? " 建议: " + changes.map((c) => `${c.field} ${c.action}${c.to != null ? `→${c.to}` : ""}`).join("; ")
            : "";
          return `${head} 预期:${s.expectation} ${s.summary || ""}${chg}`;
        })
        .join("\n")
    : "（暂无已采集公告；可要求智能体先拉取）";

  return [
    "你是 ValueInsight 估值平台的公告智能体，服务当前绑定的标的。回答只能基于以下数据上下文（DCF 假设、已入库公告与信号），不得编造上下文之外的公司数据。",
    "规则：",
    "1. 用户要求拉取/更新/重新同步公告时，必须调用 sync_announcements 工具，执行完成后再基于真实结果回答。",
    "2. 区分事实与推断；引用公告内容时注明公告标题与日期。",
    "3. 涉及假设修正建议时，字段只能取自 DCF 假设字段（baseFcf/g1/g2/g3/perpetualG/ke/wacc/e1/e2/e3/exitPe/transitionG/terminalProfitEst）。",
    "4. 上下文不足时明确说不知道，不要猜测。",
    "5. 回答用简体中文，简洁、结构化。",
    "",
    `【当前标的】${company.name}（${company.ticker}）`,
    `【DCF 假设（当前值）】${assumptionLines}`,
    "【近期公告与信号】",
    annLines,
  ].join("\n");
}

export async function POST(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  let body: { companyId?: string; messages?: ClientMsg[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("请求体必须是 JSON", 400, "BAD_BODY");
  }
  if (!body || typeof body !== "object") {
    return jsonError("请求体必须是 JSON 对象", 400, "BAD_BODY");
  }
  const companyId = body.companyId;
  if (!companyId) {
    return jsonError("缺少 companyId", 400, "BAD_BODY");
  }
  const messages: ClientMsg[] = Array.isArray(body.messages) ? body.messages : [];
  const history: ChatMessage[] = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }));

  try {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return jsonError("标的不存在", 404, "COMPANY_NOT_FOUND");
    }

    const dbCfg = await readLlmDbSettings();
    const cfg = resolveLlmConfig(dbCfg);
    if (!cfg) {
      return jsonOk({
        llmReady: false,
        reply: null,
        error:
          "未配置 LLM API。请在页面右上角「API 配置」填入 Base URL / API Key / Model，或在部署环境变量中配置 LLM_API_KEY。",
      });
    }

    const systemPrompt = await buildSystemPrompt(companyId, company);
    const baseMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history,
    ];

    const first = await chatCompletion({
      config: dbCfg,
      messages: baseMessages,
      tools: [SYNC_TOOL],
      maxTokens: MAX_TOKENS,
    });
    if (!first) {
      return jsonOk({
        llmReady: true,
        reply: null,
        error: "AI 服务调用失败（超时或网络错误），请稍后重试或检查 API 配置。",
      });
    }

    let reply = first.content;
    let toolUsed = false;
    let toolSummary: Record<string, unknown> | null = null;

    // 工具调用：最多执行一轮（防循环）
    const syncCall = first.toolCalls.find((t) => t.function?.name === "sync_announcements");
    if (syncCall) {
      toolUsed = true;
      let days = 30;
      try {
        const args = JSON.parse(syncCall.function?.arguments || "{}") as { days?: unknown };
        if (typeof args.days === "number" && Number.isFinite(args.days)) {
          days = Math.min(90, Math.max(1, Math.floor(args.days)));
        }
      } catch {
        /* 参数解析失败用默认 30 天 */
      }

      let toolContent: string;
      try {
        const result = await syncCompanyAnnouncements(companyId, days);
        toolContent = JSON.stringify({ ok: true, ...result });
        toolSummary = {
          ok: true,
          fetched: result.fetched,
          added: result.added,
          analyzed: result.analyzed,
          signals: result.signals,
          failed: result.failed.length,
          llmReady: result.llmReady,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "同步失败";
        toolContent = JSON.stringify({ ok: false, error: msg });
        toolSummary = { ok: false, error: msg };
      }

      const second = await chatCompletion({
        config: dbCfg,
        messages: [
          ...baseMessages,
          { role: "assistant", content: null, tool_calls: first.toolCalls },
          { role: "tool", tool_call_id: syncCall.id, content: toolContent },
        ],
        maxTokens: MAX_TOKENS,
      });
      if (second?.content) {
        reply = second.content;
      } else if (!reply) {
        // 模型第二轮也失败：用工具真实结果兜底回答
        reply = toolSummary?.ok
          ? `已同步完成：拉取 ${toolSummary.fetched} 条，新增 ${toolSummary.added} 条，产生信号 ${toolSummary.signals} 条（失败 ${toolSummary.failed} 条）。`
          : `公告同步失败：${toolSummary?.error ?? "未知错误"}。`;
      }
    }

    return jsonOk({
      llmReady: true,
      model: cfg.model,
      reply,
      toolUsed,
      toolSummary,
    });
  } catch (e) {
    return jsonError(
      `智能体请求失败：${e instanceof Error ? e.message : "未知错误"}`,
      500,
      "AGENT_FAILED",
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
