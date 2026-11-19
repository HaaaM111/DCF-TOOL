import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { analyzeAnnouncement, llmReady } from "@/lib/announcement/analyzer";
import type { LlmConfig } from "@/lib/ai-client";

export interface AnalyzeResult {
  attempted: number;
  analyzed: number;
  signals: number;
  skipped: number;
  failed: { announcementId: string; title: string; reason: string }[];
  llmReady: boolean;
}

const BATCH_SLEEP_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AnalyzeOptions {
  announcementIds?: string[];
  config?: Partial<LlmConfig> | null;
  signal?: AbortSignal;
}

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

  if (!ready) {
    return {
      attempted: candidates.length,
      analyzed: 0,
      signals: 0,
      skipped,
      failed: [],
      llmReady: false,
    };
  }

  const abortSignal=opts.signal??AbortSignal.timeout(90000);
  let analyzed = 0;
  const failed: { announcementId: string; title: string; reason: string }[] = [];

  for (const a of candidates) {
    if(abortSignal.aborted)break;
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
        abortSignal,
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
