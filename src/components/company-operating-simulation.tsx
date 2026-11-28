"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Spin, Table, Typography } from "antd";
import type { OperatingModelReport } from "@/lib/operating-model-input";

type Simulation = NonNullable<OperatingModelReport["simulation"]>;
type Response = { revision: string; currency: string; simulation: Simulation | null };
const money = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 2 });

export function OperatingSimulationResults({ simulation, currency }: { simulation: Simulation; currency: string }) {
  const { config, coherent, capped, rejected } = simulation;
  const { samples, seed, waccStd, growthStd, minimumSpread } = config;

  return <>
    <Typography.Paragraph type="secondary">
      有效 {samples - rejected} / {samples} 次，种子 {seed}，剔除 {rejected} 次。
      WACC 标准差 {percent.format(waccStd)}，永续增长率标准差 {percent.format(growthStd)}。
      按最小利差 {percent.format(minimumSpread)} 下调永续增长率 {capped} 次。
    </Typography.Paragraph>
    <Table size="small" rowKey="name" pagination={false} scroll={{ x: 450 }} dataSource={[
      { name: "经营口径", stats: coherent },
    ]} columns={[
      { title: "口径", dataIndex: "name" },
      ...(["p5", "median", "p95", "mean"] as const).map((key) => ({
        title: { p5: "P5", median: "P50", p95: "P95", mean: "均值" }[key],
        key, align: "right" as const,
        render: (_: unknown, { stats }: { stats: Simulation["coherent"] }) =>
          stats ? `${money.format(stats[key])} ${currency}/股` : "—",
      })),
    ]} />
    <Typography.Paragraph type="secondary" className="mt-2 mb-0">
      每个样本重算资本费用及折现，项目冲击如有配置会同时调整税后经营利润和净经营资产。
    </Typography.Paragraph>
  </>;
}

export default function CompanyOperatingSimulation({ companyId, revision }: { companyId: string; revision: string }) {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    fetch(`/api/companies/${encodeURIComponent(companyId)}/simulation`, { cache: "no-store", signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || "读取经营估值模拟失败");
        const next = await response.json() as Response;
        if (next.revision !== revision) throw new Error("底稿版本已更新，请刷新页面");
        if (!controller.signal.aborted) setData(next);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(signal.aborted ? "读取经营估值模拟超时" : cause instanceof Error ? cause.message : "读取经营估值模拟失败");
        }
      });
    return () => controller.abort();
  }, [attempt, companyId, revision]);

  return (
    <Card title="经营估值蒙特卡洛" extra="已发布底稿" className="mb-4">
      {error ? <Alert type="error" showIcon title={error} action={
        <Button onClick={() => { setError(""); setAttempt((value) => value + 1); }}>重试</Button>
      } /> : !data ? <div className="py-6 text-center"><Spin description="正在计算经营估值模拟…" /></div>
        : data.simulation ? <OperatingSimulationResults simulation={data.simulation} currency={data.currency} />
        : <Empty description="已发布底稿未配置蒙特卡洛" />}
    </Card>
  );
}
