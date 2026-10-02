"use client";

import ReactECharts from "echarts-for-react";
import type { SensitivityHeatmapCell } from "@/lib/valuation-validation";

interface ValidationSummary {
  currentPe: number;
  currentPb: number;
  currentPs: number;
  industryPeMean: number;
  industryPbMean: number;
  industryPsMean: number;
  pePercentile: number;
  pbPercentile: number;
  psPercentile: number;
  premiumDiscount: number;
}

/**
 * 横向对比柱状图：本公司 PE/PB/PS vs 行业均值
 */
export function PeerCompareChart({ data }: { data: ValidationSummary }) {
  const option = {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0, data: ["本公司", "行业均值"] },
    grid: { left: 60, right: 30, top: 40, bottom: 30 },
    xAxis: { type: "category", data: ["PE", "PB", "PS"] },
    yAxis: { type: "value" },
    series: [
      {
        name: "本公司",
        type: "bar",
        data: [
          { value: +data.currentPe.toFixed(2), itemStyle: { color: "#1E3A5F" } },
          { value: +data.currentPb.toFixed(2), itemStyle: { color: "#1E3A5F" } },
          { value: +data.currentPs.toFixed(2), itemStyle: { color: "#1E3A5F" } },
        ],
        barWidth: 28,
        label: { show: true, position: "top" },
      },
      {
        name: "行业均值",
        type: "bar",
        data: [
          { value: +data.industryPeMean.toFixed(2), itemStyle: { color: "#94A3B8" } },
          { value: +data.industryPbMean.toFixed(2), itemStyle: { color: "#94A3B8" } },
          { value: +data.industryPsMean.toFixed(2), itemStyle: { color: "#94A3B8" } },
        ],
        barWidth: 28,
        label: { show: true, position: "top" },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 280 }} />;
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
  diffRate: number;
  conclusion: string;
}) {
  const isDeviating = diffRate >= 20;
  const maxVal = Math.max(absoluteValue, relativeValue) * 1.1 || 1;
  const absPct = (absoluteValue / maxVal) * 100;
  const relPct = (relativeValue / maxVal) * 100;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span style={{ color: "#1E3A5F" }}>DCF 绝对估值</span>
          <span style={{ color: "#1E3A5F", fontWeight: 600 }}>{absoluteValue.toFixed(1)} 亿</span>
        </div>
        <div style={{ height: 22, background: "#f1f5f9", borderRadius: 11, overflow: "hidden" }}>
          <div
            style={{
              width: `${absPct}%`,
              height: "100%",
              background: "#1E3A5F",
              borderRadius: 11,
              transition: "width 0.5s",
            }}
          />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span style={{ color: "#0EA5E9" }}>相对估值（PE/PB/PS 中位数法）</span>
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
 * 敏感性热力图：WACC × 永续 g
 * 颜色越绿估值越高，越红估值越低
 */
export function SensitivityHeatmap({ matrix }: { matrix: SensitivityHeatmapCell[] }) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return <div style={{ height: 360, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>暂无热力图数据</div>;
  }
  const waccValues = Array.from(new Set(matrix.map((c) => c.wacc))).sort((a, b) => a - b);
  const gValues = Array.from(new Set(matrix.map((c) => c.g))).sort((a, b) => a - b);

  const prices = matrix.map((c) => c.targetPrice).filter((v) => v > 0);
  const minP = prices.length ? Math.min(...prices) : 0;
  const maxP = prices.length ? Math.max(...prices) : 1;

  const data = matrix.map((c) => {
    const x = gValues.indexOf(c.g);
    const y = waccValues.indexOf(c.wacc);
    return [x, y, +c.targetPrice.toFixed(2)];
  });

  const option = {
    tooltip: {
      position: "top",
      formatter: (p: { value: number[] }) => {
        const [x, y, v] = p.value;
        return `WACC=${(waccValues[y] * 100).toFixed(0)}%<br/>永续g=${(gValues[x] * 100).toFixed(0)}%<br/>目标价=¥${v}`;
      },
    },
    grid: { height: "60%", top: "10%", left: 60, right: 30 },
    xAxis: {
      type: "category",
      data: gValues.map((g) => `${(g * 100).toFixed(0)}%`),
      splitArea: { show: true },
      name: "永续增长率 g",
      nameLocation: "middle",
      nameGap: 28,
    },
    yAxis: {
      type: "category",
      data: waccValues.map((w) => `${(w * 100).toFixed(0)}%`),
      splitArea: { show: true },
      name: "WACC",
      nameLocation: "middle",
      nameGap: 40,
    },
    visualMap: {
      min: minP,
      max: maxP,
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
        label: { show: true, fontSize: 11, color: "#000" },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.5)" } },
      },
    ],
  };

  return <ReactECharts option={option} style={{ width: "100%", height: 360 }} notMerge lazyUpdate />;
}
