/**
 * POST /api/validation
 * 估值验证：绝对(DCF) × 相对(PE/PB/PS) 交叉验证 + AI 归因 + 敏感性热力图
 *
 * 请求体：{ companyId }
 *
 * 流程：
 *   1. 取公司 + 假设 → 算 DCF 绝对估值
 *   2. 取同行（本地股票池按行业匹配）→ 算行业均值 → 相对估值
 *   3. 取历史估值分位（无历史则中性 50）
 *   4. 交叉验证 → 差异率 ≥ 20% 触发 AI 归因（30s 超时）
 *   5. 2D 敏感性热力图（WACC × g）
 *   6. 落库 ValidationResult（与最新 ValuationReport 关联）
 */
import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { calcDcf } from "@/lib/dcf";
import {
  calcRelativeValuation,
  calcHistoricalPercentiles,
  crossValidate,
  calcSensitivityHeatmap,
  buildAiAttributionPrompt,
  DIFF_THRESHOLD,
  type PeerData,
} from "@/lib/valuation-validation";
import { getIndustryPeers } from "@/lib/ifind-client";
import { resolveCompanyData } from "@/lib/data-source";
import { chatWithDeepSeek, hasDeepSeekCredentials, sanitizeAiText } from "@/lib/ai-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = guardRequest(req);
  if (guard) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("请求体不是合法的 JSON", 400, "INVALID_JSON");
  }

  const { companyId } = (body ?? {}) as { companyId?: string };
  if (!companyId) {
    return jsonError("缺少 companyId", 400, "MISSING_COMPANY_ID");
  }

  // 1. 取公司（用户库）+ 假设（用户库）
  const baseCompany = await prisma.company.findUnique({
    where: { id: companyId },
  });
  if (!baseCompany) {
    return jsonError("标的不存在", 404, "NOT_FOUND");
  }
  const assumption = await prisma.assumption.findUnique({
    where: { companyId },
  });
  if (!assumption) {
    return jsonError("该标的暂无估值假设，请先在模型编辑页设置", 400, "NO_ASSUMPTION");
  }

  const company = { ...baseCompany, assumption };
  const a = company.assumption;
  const b = {
    currentPrice: company.currentPrice,
    shares: company.shares,
    netCash: company.netCash,
    e0: company.e0,
  };

  // 2. DCF 绝对估值
  const output = calcDcf(a, b);
  const absoluteValue = output.forward.adjustedTargetPrice * company.shares; // 亿元

  // 3. 同行数据（本地股票池按行业匹配；行情走东财分流、财务走 iFinD→东财兜底）
  const peerTickers = getIndustryPeers(company.industry, company.ticker);
  const peers: PeerData[] = [];

  for (const peer of peerTickers.slice(0, 10)) {
    try {
      const { data } = await resolveCompanyData(peer.ticker);
      const marketCap = data.marketCap || data.currentPrice * data.shares;
      peers.push({
        ticker: peer.ticker,
        name: data.name || peer.name,
        marketCap,
        e0: data.e0,
        revenue: data.revenue,
        bookValue: data.bookValue,
      });
    } catch {
      // 单个同行失败不影响整体
    }
  }

  // 4. 相对估值
  const relative = calcRelativeValuation(
    company.marketCap,
    company.e0,
    company.revenue,
    company.bookValue,
    peers,
  );

  // 5. 历史分位（从 HistoricalValuation 表取；无数据则中性）
  const history = await prisma.historicalValuation.findMany({
    where: { companyId },
    orderBy: { year: "asc" },
  });
  const percentiles = calcHistoricalPercentiles(
    { pe: relative.currentPe, pb: relative.currentPb, ps: relative.currentPs },
    history,
  );

  // 6. 交叉验证
  const { diffRate, conclusion } = crossValidate(absoluteValue, relative.relativeValue);

  // 7. AI 归因（差异率 ≥ 阈值时触发）
  let aiAttribution: string | null = null;
  if (diffRate >= DIFF_THRESHOLD) {
    if (hasDeepSeekCredentials()) {
      const prompt = buildAiAttributionPrompt({
        name: company.name,
        absoluteValue,
        relativeValue: relative.relativeValue,
        diffRate,
        g1: a.g1,
        g2: a.g2,
        g3: a.g3,
        perpetualG: a.perpetualG,
        ke: a.ke,
        currentPe: relative.currentPe,
        industryPeMean: relative.industryPeMean,
        pePercentile: percentiles.pePercentile,
        premiumDiscount: relative.premiumDiscount,
      });
      aiAttribution = await chatWithDeepSeek(
        "你是一位资深 A 股估值分析师，擅长 DCF 与相对估值的交叉验证。",
        prompt,
      );
    } else {
      aiAttribution = "AI 归因未启用：未配置 DEEPSEEK_API_KEY。请在 .env.local 中配置后重试。";
    }
  }

  // 8. 2D 敏感性热力图
  const heatmap = calcSensitivityHeatmap(a, b);

  // 9. 关联最新 ValuationReport 并落库
  const latestReport = await prisma.valuationReport.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });

  const resultData = {
    companyId,
    reportId: latestReport?.id ?? "",
    absoluteValue,
    peValue: relative.peValue,
    pbValue: relative.pbValue,
    psValue: relative.psValue,
    relativeValue: relative.relativeValue,
    currentPe: relative.currentPe,
    currentPb: relative.currentPb,
    currentPs: relative.currentPs,
    industryPeMean: relative.industryPeMean,
    industryPeMedian: relative.industryPeMedian,
    industryPbMean: relative.industryPbMean,
    industryPsMean: relative.industryPsMean,
    pePercentile: percentiles.pePercentile,
    pbPercentile: percentiles.pbPercentile,
    psPercentile: percentiles.psPercentile,
    premiumDiscount: relative.premiumDiscount,
    diffRate,
    conclusion,
    aiAttribution: aiAttribution ? sanitizeAiText(aiAttribution) : null,
    sensitivityHeatmap: heatmap as unknown as Prisma.InputJsonValue,
  };

  // 同一 reportId 只存一条（upsert）；若无 reportId 则仅返回不落库
  let saved;
  if (latestReport) {
    saved = await prisma.validationResult.upsert({
      where: { reportId: latestReport.id },
      update: resultData,
      create: resultData,
    });
  }

  return jsonOk({
    validation: saved ?? resultData,
    peers: relative.peers,
    hasHistory: history.length > 0,
    aiEnabled: hasDeepSeekCredentials(),
  });
}

export async function OPTIONS(req: NextRequest) {
  return guardRequest(req) ?? new Response(null, { status: 204 });
}
