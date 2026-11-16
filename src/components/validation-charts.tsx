"use client";

import { memo, useMemo } from "react";
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

export const PeerCompareChart = memo(function PeerCompareChart({ data }: { data: ValidationSummary }) {
  const option = useMemo(() => ({
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
          { value: +data.currentPe.toFixed(2), itemStyle: { color: "#244334" } },
          { value: +data.currentPb.toFixed(2), itemStyle: { color: "#244334" } },
          { value: +data.currentPs.toFixed(2), itemStyle: { color: "#244334" } },
        ],
        barWidth: 28,
        label: { show: true, position: "top" },
      },
      {
        name: "行业均值",
        type: "bar",
        data: [
          { value: +data.industryPeMean.toFixed(2), itemStyle: { color: "#a8b0ab" } },
          { value: +data.industryPbMean.toFixed(2), itemStyle: { color: "#a8b0ab" } },
          { value: +data.industryPsMean.toFixed(2), itemStyle: { color: "#a8b0ab" } },
        ],
        barWidth: 28,
        label: { show: true, position: "top" },
      },
    ],
  }), [data]);
  return <ReactECharts option={option} style={{ height: 280 }} notMerge lazyUpdate />;
});

export const ValidationGauge = memo(function ValidationGauge({
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
          <span style={{ color: "#244334" }}>DCF 绝对估值</span>
          <span style={{ color: "#244334", fontWeight: 600 }}>{absoluteValue.toFixed(1)} 亿</span>
        </div>
        <div style={{ height: 22, background: "#f1f3f0", borderRadius: 11, overflow: "hidden" }}>
          <div
            style={{
              width: `${absPct}%`,
              height: "100%",
              background: "#244334",
              borderRadius: 11,
              transition: "width 0.5s",
            }}
          />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span style={{ color: "#8a938d" }}>相对估值（PE/PB/PS 中位数法）</span>
          <span style={{ color: "#8a938d", fontWeight: 600 }}>{relativeValue.toFixed(1)} 亿</span>
        </div>
        <div style={{ height: 22, background: "#f1f3f0", borderRadius: 11, overflow: "hidden" }}>
          <div
            style={{
              width: `${relPct}%`,
              height: "100%",
              background: "#8a938d",
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
          background: isDeviating ? "#f1f3f0" : "#f1f3f0",
          border: `1px solid ${isDeviating ? "#c9b896" : "#9fb3a7"}`,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 13, color: "#77817a" }}>差异率</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: isDeviating ? "#9c5a4e" : "#315e49" }}>
          {diffRate.toFixed(1)}%
        </div>
        <div style={{ fontSize: 13, color: isDeviating ? "#9c5a4e" : "#315e49", marginTop: 4 }}>
          {conclusion}（阈值 20%）
        </div>
      </div>
    </div>
  );
});

export const SensitivityHeatmap = memo(function SensitivityHeatmap({ matrix }: { matrix: SensitivityHeatmapCell[] }) {
  const option = useMemo(() => {
    if (!Array.isArray(matrix) || matrix.length === 0) return null;

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

    return {
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
        color: ["#9c5a4e", "#c3b59a", "#315e49"], // 砖红→卡其→机构绿
      },
    },
    series: [
      {
        name: "目标价",
        type: "heatmap",
        data,
        label: { show: true, fontSize: 11, color: "#202c26" },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.5)" } },
      },
    ],
    };
  }, [matrix]);

  if (!option) {
    return <div style={{ height: 360, display: "flex", alignItems: "center", justifyContent: "center", color: "#77817a" }}>暂无热力图数据</div>;
  }

  return <ReactECharts option={option} style={{ width: "100%", height: 360 }} notMerge lazyUpdate />;
});
