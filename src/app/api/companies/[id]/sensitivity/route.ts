import type { NextRequest } from "next/server";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { idSchema } from "@/lib/agent/schemas";
import { getOperatingPublication, getOperatingRevision } from "@/lib/operating-model-store";
import { operatingSensitivity } from "@/lib/operating-scenarios";
import { selectPrimaryValuation } from "@/lib/primary-valuation";
import { prisma } from "@/lib/prisma";
import type { CompanySensitivity } from "@/lib/sensitivity-grid";
import { assumptionsSchema, companySchema } from "@/lib/validation";
import { calcSensitivityHeatmap } from "@/lib/valuation-validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const guard = guardRequest(request);
  if (guard) return guard;
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) return jsonError("标的参数无效", 422);
  const companyId = parsed.data;
  try {
    const [company, snapshot, saved, publication] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId } }),
      prisma.companySnapshot.findUnique({ where: { companyId } }),
      prisma.assumption.findUnique({ where: { companyId } }),
      getOperatingPublication(companyId),
    ]);
    if (!company) return jsonError("标的不存在", 404);
    const primary = selectPrimaryValuation({ ...company, targetPrice: snapshot?.targetPrice }, publication);
    if (primary.kind === "unavailable") return jsonOk({ sensitivity: null, reason: primary.reason });
    let sensitivity: CompanySensitivity;
    if (primary.kind === "operating") {
      const published = primary.publication;
      const input = await getOperatingRevision(companyId, published.revision);
      if (!input) return jsonOk({ sensitivity: null, reason: "已发布底稿不可用，暂不生成敏感性。" });
      const cells = operatingSensitivity(input);
      sensitivity = { kind: "operating", rateLabel: "WACC", currency: published.currency, valuationDate: published.valuationDate,
        base: { wacc: input.wacc, g: input.terminalGrowth, price: primary.price },
        matrix: cells.map(({ wacc, g, coherentPrice }) => ({ wacc, g, targetPrice: coherentPrice })),
        workbookMatrix: cells.map(({ wacc, g, workbookPrice }) => ({ wacc, g, targetPrice: workbookPrice })),
      };
    } else {
      const inputs = assumptionsSchema.safeParse(saved);
      const basics = companySchema.safeParse(company);
      if (!inputs.success || !basics.success) return jsonOk({ sensitivity: null, reason: "已保存的假设或基础数据不足，暂不生成敏感性。" });
      sensitivity = { kind: "legacy", rateLabel: "Ke",
        currency: /\.HK$/i.test(company.ticker) ? "HKD" : /\.(SH|SZ|BJ)$/i.test(company.ticker) ? "CNY" : "当地币",
        valuationDate: null, base: { wacc: inputs.data.ke, g: inputs.data.perpetualG, price: primary.price },
        matrix: calcSensitivityHeatmap(inputs.data, basics.data),
      };
    }
    const baseline = sensitivity.matrix.find(({ wacc, g }) => wacc === sensitivity.base.wacc && g === sensitivity.base.g);
    const tolerance = Math.max(1e-8, Math.abs(sensitivity.base.price) * 1e-9);
    if (baseline?.targetPrice == null || !Number.isFinite(baseline.targetPrice)
        || Math.abs(baseline.targetPrice - sensitivity.base.price) > tolerance) {
      return jsonOk({ sensitivity: null, reason: "基准格与已保存估值不一致，请复核底稿后重新保存或发布。" });
    }
    return jsonOk({ sensitivity, reason: null });
  } catch {
    return jsonError("读取估值敏感性失败，请稍后重试。", 503);
  }
}
