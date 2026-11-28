/**
 * POST /api/import —— 导入估值标的（JSON）
 *
 * 入参：请求体为 JSON，形状与 GET /api/export 导出的文件一致
 *   [{ "company": {...}, "assumptions": {...} }]   或   { "items": [...] }
 * 出参：{ created, skipped, failed, errors }
 *
 * 约束：
 * - 登录态校验 + 限流（guardRequest）
 * - 请求体大小上限 MAX_IMPORT_BYTES（默认 5MB），单次最多 MAX_ITEMS 条
 * - 逐条走 zod 校验（companySchema / assumptionsSchema）
 * - 仅写入当前账号；同一账号下 ticker 重复的条目跳过
 */
import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { guardRequest, jsonError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { importSchema } from "@/lib/validation";
import { getAuthenticatedUserId } from "@/lib/auth";
import { calcDcf, classifyQuadrant, diagnoseNarrative } from "@/lib/dcf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 200;

export async function POST(req: NextRequest) {
    const guard = await guardRequest(req);
    if (guard) return guard;

    const maxBytes = parseInt(process.env.MAX_IMPORT_BYTES ?? "", 10) || DEFAULT_MAX_BYTES;
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
        return jsonError(
            `导入文件过大（上限 ${Math.round(maxBytes / 1024)} KB）`,
            413,
            "IMPORT_TOO_LARGE",
        );
    }

    let text: string;
    try {
        text = await req.text();
    } catch {
        return jsonError("读取导入文件失败", 400, "BAD_BODY");
    }
    if (text.length > maxBytes) {
        return jsonError(
            `导入文件过大（上限 ${Math.round(maxBytes / 1024)} KB）`,
            413,
            "IMPORT_TOO_LARGE",
        );
    }

    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return jsonError("导入文件不是合法的 JSON", 400, "INVALID_JSON");
    }
    const payload = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
            ? (raw as { items: unknown[] }).items
            : null;
    if (!payload) {
        return jsonError(
            "导入内容需为数组：[{ company, assumptions }]，或 { items: [...] }",
            400,
            "BAD_BODY",
        );
    }
    if (!payload.length) {
        return jsonError("导入内容为空", 400, "BAD_BODY");
    }
    if (payload.length > MAX_ITEMS) {
        return jsonError(`单次最多导入 ${MAX_ITEMS} 条`, 413, "IMPORT_TOO_MANY_ITEMS");
    }

    const parsed = importSchema.safeParse(payload);
    if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map((i) => {
            const path = i.path.join(".");
            return `${path || "root"}：${i.message}`;
        });
        return jsonError(`导入数据校验失败：${issues.join("；")}`, 422, "VALIDATION_ERROR");
    }

    const userId = getAuthenticatedUserId(req);
    const existing = await prisma.company.findMany({
        where: { userId },
        select: { ticker: true },
    });
    const seen = new Set(existing.map((c) => c.ticker));

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of parsed.data) {
        const c = item.company;
        if (seen.has(c.ticker)) {
            skipped += 1;
            continue;
        }
        try {
            await prisma.$transaction(async (tx) => {
                const company = await tx.company.create({
                    data: {
                        userId,
                        name: c.name,
                        ticker: c.ticker,
                        currentPrice: c.currentPrice,
                        shares: c.shares,
                        marketCap: c.marketCap,
                        cash: c.cash,
                        debt: c.debt,
                        netCashAdj: c.netCashAdj,
                        netCash: c.netCash,
                        e0: c.e0,
                        revenue: c.revenue,
                        bookValue: c.bookValue,
                        cfo: c.cfo,
                        capex: c.capex,
                        da: c.da,
                        industry: c.industry,
                        fxRate: c.fxRate,
                        kd: c.kd,
                        taxRate: c.taxRate,
                    },
                });

                if (item.assumptions) {
                    const a = item.assumptions;
                    const output = calcDcf(a, {
                        currentPrice: c.currentPrice,
                        shares: c.shares,
                        netCash: c.netCash,
                        e0: c.e0,
                    });
                    const snapshotFields = {
                        targetPrice: output.forward.adjustedTargetPrice,
                        upside: output.forward.adjustedUpside,
                        originalUpside: output.forward.originalUpside,
                        impliedKe: output.reverse.impliedKe,
                        forwardKe: a.ke,
                        wacc: output.forward.wacc,
                        terminalProfitY20: output.forward.fcfY20,
                        terminalFcfE3: a.e3 ? output.forward.fcfY20 / a.e3 : 0,
                        impliedL: output.reverse.l,
                        impliedLE3: output.reverse.lE3,
                        impliedCagr: output.reverse.impliedCagr,
                        terminalProfitEst: a.terminalProfitEst,
                        transitionG: a.transitionG,
                        quadrant: classifyQuadrant(output.reverse, a),
                        diagnosis: diagnoseNarrative(output.reverse, output.gordon, {
                            currentPrice: c.currentPrice,
                            shares: c.shares,
                            netCash: c.netCash,
                            e0: c.e0,
                        }),
                        lastEvalDate: new Date(),
                    };

                    await tx.valuationReport.create({
                        data: {
                            companyId: company.id,
                            targetPrice: output.forward.adjustedTargetPrice,
                            upside: output.forward.adjustedUpside,
                            originalUpside: output.forward.originalUpside,
                            dcfEntityValue: output.forward.originalEv,
                            impliedL: output.reverse.l,
                            impliedLE3: output.reverse.lE3,
                            impliedKe: output.reverse.impliedKe,
                            forwardKe: a.ke,
                            wacc: output.forward.wacc,
                            terminalProfitY20: output.forward.fcfY20,
                            terminalFcfE3: a.e3 ? output.forward.fcfY20 / a.e3 : 0,
                            impliedCagr: output.reverse.impliedCagr,
                            sensitivityMatrix: output.sensitivity as unknown as Prisma.InputJsonValue,
                            snapshot: { assumptions: a, output } as unknown as Prisma.InputJsonValue,
                        },
                    });

                    await tx.assumption.create({
                        data: { companyId: company.id, ...a },
                    });

                    await tx.companySnapshot.create({
                        data: { companyId: company.id, ...snapshotFields },
                    });
                }
            });
            created += 1;
            seen.add(c.ticker);
        } catch (e) {
            errors.push(
                `${c.ticker}：${e instanceof Error ? e.message : "写入失败"}`,
            );
        }
    }

    return jsonOk({
        created,
        skipped,
        failed: errors.length,
        errors: errors.slice(0, 5),
    });
}

export async function OPTIONS(req: NextRequest) {
    return (await guardRequest(req)) ?? new Response(null, { status: 204 });
}
