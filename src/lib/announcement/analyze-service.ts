/**
 * 公告批量分析服务（供智能体 analyze_announcements 工具调用）
 * ------------------------------------------------------------------
 * 流程：读标的 → 读当前 DCF 假设 → 取该公司"已采集但未分析"的公告
 *      → 逐条调用 LLM 生成预期差信号 → 写回 AnnouncementSignal 并标记 analyzed=true
 * 配置：env 优先 + DB（页面配置）兜底；未配置 key 时 llmReady=false，返回空结果不报错。
 * 幂等：只处理 analyzed=false 的公告；指定 announcementIds 时可定向分析。
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { analyzeAnnouncement, llmReady } from "@/lib/announcement/analyzer";
import type { LlmConfig } from "@/lib/ai-client";

export interface AnalyzeResult {
  attempted: number; // 本次尝试分析的公告数
  analyzed: number; // 成功产生信号的公告数
  signals: number; // 产生的信号条数（与分析数一致，一公告至多一信号）
  skipped: number; // 跳过数（无正文/无假设，无法分析）
  failed: { announcementId: string; title: string; reason: string }[];
  llmReady: boolean;
}

const BATCH_SLEEP_MS = 300; // LLM 调用间隔，礼貌限速

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AnalyzeOptions {
  /** 定向分析指定公告（须属于该公司）；缺省 = 全部未分析公告 */
  announcementIds?: string[];
  /** DB 兜底配置（env 优先在 resolveLlmConfig 内部处理） */
  config?: Partial<LlmConfig> | null;
}

/**
 * 分析某公司已采集但未分析的公告，生成预期差信号并入库。
 * 抛错仅用于不可恢复的整批失败（标的不存在）。
 */
export async function analyzeCompanyAnnouncements(
  companyId: string,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    throw new Error("标的不存在");
  }

  const ready = llmReady(opts.config ?? null);
  const assumptions = await prisma.assumption.findUnique({
    where: { companyId },
  });

  const candidates = await prisma.announcement.findMany({
    where: {
      companyId,
      analyzed: false,
      rawText: { not: null },
      ...(opts.announcementIds?.length
        ? { id: { in: opts.announcementIds } }
        : {}),
    },
    orderBy: { publishAt: "desc" },
    take: 50,
  });

  const skipped = candidates.filter((a) => !a.rawText || !assumptions).length;

  let analyzed = 0;
  const failed: { announcementId: string; title: string; reason: string }[] = [];

  for (const a of candidates) {
    if (!a.rawText || !assumptions) continue;
    try {
      const assumptionMap: Record<string, number> = {
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
      };

      const signal = await analyzeAnnouncement(
        a.title,
        a.rawText,
        assumptionMap,
        opts.config ?? null,
      );

      if (!signal) {
        failed.push({
          announcementId: a.id,
          title: a.title,
          reason: "LLM 未返回有效信号（无 key / 解析失败 / 内容无法判断）",
        });
        continue;
      }

      await prisma.announcement.update({
        where: { id: a.id },
        data: {
          analyzed: true,
          signals: {
            create: {
              expectation: signal.expectation,
              direction: signal.direction,
              summary: (signal.summary ?? "").slice(0, 500),
              evidence: (signal.evidence ?? []).slice(0, 3).join("\n").slice(0, 1000),
              suggestedChanges:
                (signal.suggestedChanges ?? []) as unknown as Prisma.InputJsonValue,
            },
          },
        },
      });
      analyzed += 1;
      await sleep(BATCH_SLEEP_MS);
    } catch (e) {
      failed.push({
        announcementId: a.id,
        title: a.title,
        reason: e instanceof Error ? e.message : "未知错误",
      });
    }
  }

  return {
    attempted: candidates.length,
    analyzed,
    signals: analyzed,
    skipped,
    failed,
    llmReady: ready,
  };
}
