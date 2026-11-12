"use client";

import ReactECharts from "@/components/terminal-chart";
import type { SensitivityHeatmapCell } from "@/lib/valuation-validation";

export function PeerCompareChart({ methods }: {
  methods: { name: string; count: number; current: number | null; mean: number | null; median: number | null }[];
}) {
  const comparable = ["P/E", "P/B", "P/S"].map((name) => methods.find((method) => method.name === name));
  const series = [
    { name: "本公司", key: "current", color: "#3b82f6" },
    { name: "同行中位数", key: "median", color: "#10b981" },
    { name: "同行均值", key: "mean", color: "#94a3b8" },
  ] as const;
  const option = {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0 },
    grid: { left: 60, right: 30, top: 40, bottom: 30 },
    xAxis: { type: "category", data: ["PE", "PB", "PS"] },
    yAxis: { type: "value" },
    series: series.map(({ name, key, color }) => ({
      name, type: "bar", itemStyle: { color }, barMaxWidth: 24,
      data: comparable.map((method) => {
        const value = method && (key === "current" || method.count >= 3) ? method[key] : null;
        return value == null ? null : Number(value.toFixed(2));
      }),
    })),
  };
  return <ReactECharts className="chart-settle" option={option} style={{ height: 280 }} />;
}

/**
 * 绝对 vs 相对 估值差异仪表盘
 * 用进度条直观展示 DCF 估值与相对估值的差异率
 */
export function ValidationGauge({
  absoluteValue,
  relativeValue,
  diffRate,
  conclusion,
}: {
  absoluteValue: number;
  relativeValue: number;
  diffRate: number | null;
  conclusion: string;
}) {
  if(diffRate === null) return <div role="status">有效同行或财务字段不足，暂无可比较估值。</div>;
  const isDeviating = diffRate >= 20;
  const maxVal = Math.max(absoluteValue, relativeValue) * 1.1 || 1;
  const absPct = (absoluteValue / maxVal) * 100;
  const relPct = (relativeValue / maxVal) * 100;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span style={{ color: "#3b82f6" }}>DCF 绝对估值</span>
          <span style={{ color: "#3b82f6", fontWeight: 600 }}>{absoluteValue.toFixed(1)} 亿</span>
        </div>
        <div style={{ height: 22, background: "#f1f5f9", borderRadius: 11, overflow: "hidden" }}>
          <div
            style={{
              width: `${absPct}%`,
              height: "100%",
              background: "#3b82f6",
              borderRadius: 11,
              transition: "width 0.5s",
            }}
          />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span style={{ color: "#0EA5E9" }}>相对估值（有效倍数估值中位数）</span>
          <span style={{ color: "#0EA5E9", fontWeight: 600 }}>{relativeValue.toFixed(1)} 亿</span>
        </div>
        <div style={{ height: 22, background: "#f1f5f9", borderRadius: 11, overflow: "hidden" }}>
          <div
            style={{
              width: `${relPct}%`,
              height: "100%",
              background: "#0EA5E9",
              borderRadius: 11,
              transition: "width 0.5s",
            }}
          />
        </div>
      </div>
      <div
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: isDeviating ? "#FFF7ED" : "#F0FDF4",
          border: `1px solid ${isDeviating ? "#FDBA74" : "#86EFAC"}`,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 13, color: "#64748B" }}>差异率</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: isDeviating ? "#EA580C" : "#16A34A" }}>
          {diffRate.toFixed(1)}%
        </div>
        <div style={{ fontSize: 13, color: isDeviating ? "#EA580C" : "#16A34A", marginTop: 4 }}>
          {conclusion}（阈值 20%）
        </div>
      </div>
    </div>
  );
}

/**
 * 敏感性热力图：Ke × 永续 g
 * 颜色越绿估值越高，越红估值越低
 */
export function SensitivityHeatmap({
  matrix, rateLabel = "Ke", currency = "CNY",
}: {
  matrix: (Omit<SensitivityHeatmapCell, "targetPrice"> & { targetPrice: number | null })[];
  rateLabel?: string;
  currency?: string;
}) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return <div style={{ height: 360, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>暂无热力图数据</div>;
  }
  const waccValues = Array.from(new Set(matrix.map((c) => c.wacc))).sort((a, b) => a - b);
  const gValues = Array.from(new Set(matrix.map((c) => c.g))).sort((a, b) => a - b);

  const prices = matrix.flatMap(({ targetPrice }) => targetPrice === null ? [] : [targetPrice]);
  const minP = prices.length ? Math.min(...prices) : 0;
  const maxP = prices.length ? Math.max(...prices) : 1;
  const rate = (value: number) => `${Number((value * 100).toFixed(4))}%`;

  const data = matrix.flatMap((c) => {
    if (c.targetPrice === null) return [];
    const x = gValues.indexOf(c.g);
    const y = waccValues.indexOf(c.wacc);
    return [[x, y, c.targetPrice]];
  });

  const option = {
    tooltip: {
      position: "top",
      formatter: (p: { value: number[] }) => {
        const [x, y, v] = p.value;
        return `${rateLabel}=${rate(waccValues[y])}<br/>永续 g=${rate(gValues[x])}<br/>每股价值=${v.toFixed(2)} ${currency}`;
      },
    },
    grid: { height: "60%", top: "10%", left: 60, right: 30 },
    xAxis: {
      type: "category",
      data: gValues.map(rate),
      splitArea: { show: true },
      name: "永续增长率 g",
      nameLocation: "middle",
      nameGap: 28,
    },
    yAxis: {
      type: "category",
      data: waccValues.map(rate),
      splitArea: { show: true },
      name: rateLabel,
      inverse: true,
      nameLocation: "middle",
      nameGap: 40,
    },
    visualMap: {
      min: minP,
      max: maxP > minP ? maxP : minP + 1,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: "5%",
      inRange: {
        color: ["#DC2626", "#F59E0B", "#10B981"], // 红→黄→绿
      },
    },
    series: [
      {
        name: "目标价",
        type: "heatmap",
        data,
        label: { show: true, fontSize: 10, color: "#000", formatter: (p: { value: number[] }) => p.value[2].toFixed(2) },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.5)" } },
      },
    ],
  };

  return <ReactECharts className="chart-settle" option={option} style={{ width: "100%", height: 360 }} notMerge lazyUpdate />;
}
