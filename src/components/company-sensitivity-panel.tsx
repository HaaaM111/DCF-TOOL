"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Spin } from "antd";
import type { CompanySensitivity } from "@/lib/sensitivity-grid";
import { SensitivityHeatmap } from "./validation-charts";

type Result = { sensitivity: CompanySensitivity | null; reason: string | null };

export default function CompanySensitivityPanel({ companyId }: { companyId: string }) {
  const [result, setResult] = useState<Result>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/companies/${encodeURIComponent(companyId)}/sensitivity`, {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    }).then(async (response) => {
      if (!response.ok) throw new Error("Sensitivity unavailable");
      const data: Result = await response.json();
      if (!controller.signal.aborted) setResult(data);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [companyId, attempt]);

  const data = result?.sensitivity;
  return <Card className="mb-4" title={data ? `敏感性热力图（${data.rateLabel} × 永续 g）` : "敏感性热力图"}>
    {!result && !failed && <Spin description="正在读取估值底稿并计算情景…" />}
    {failed && <Alert type="warning" showIcon title="暂时无法读取估值敏感性"
      action={<Button size="small" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>重试</Button>} />}
    {result && !data && <Alert type="info" showIcon title={result.reason ?? "暂无可复核的估值底稿"} />}
    {data && <>
      <p className="mt-2 mb-3 text-sm text-terminal-muted">
        {data.kind === "legacy" ? "以已保存的简化股东回报模型为基准，保持经营假设不变，逐格更换 Ke 和永续增长率。"
          : "显性期经营预测保持不变；逐格更换 WACC 与永续增长率，并按情景 WACC 重算资本费用和折现。"}
        {data.valuationDate && ` 估值基准日：${data.valuationDate}。`}
      </p>
      <SensitivityHeatmap rateLabel={data.rateLabel} currency={data.currency} base={data.base}
        matrix={data.matrix} />
    </>}
  </Card>;
}
