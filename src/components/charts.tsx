"use client";

import ReactECharts from "echarts-for-react";
import type { MonteCarloResult, ValueComposition } from "@/types/dcf";

/** 价值构成环形图（终值 / 显性期 / 留存现金 / 净现金） */
export function ValueDonut({ comp }: { comp: ValueComposition }) {
  const items = [
    { name: "终值（20年后永续派现）", value: comp.terminal, color: "#1E3A5F" },
    { name: "显性期（前20年派现折现）", value: comp.explicit, color: "#4F46E5" },
    { name: "留存现金累积（按2%复利）", value: comp.retainedCash, color: "#F59E0B" },
    { name: "净现金 (+) / 净负债 (-)", value: comp.netCash, color: "#10B981" },
  ];
  const total = comp.total || 1;

  const option = {
    tooltip: {
      trigger: "item",
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>${p.value.toFixed(1)} 亿 (${p.percent}%)`,
    },
    legend: {
      orient: "vertical",
      right: 10,
      top: "center",
      itemWidth: 12,
      itemHeight: 12,
      textStyle: { fontSize: 12 },
    },
    series: [
      {
        name: "价值构成",
        type: "pie",
        radius: ["52%", "78%"],
        center: ["35%", "50%"],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 4, borderColor: "#fff", borderWidth: 2 },
        label: {
          show: true,
          position: "center",
          formatter: [`{a|${total.toFixed(0)}}`, "{b|亿 · 股权价值}"].join("\n"),
          rich: {
            a: { fontSize: 22, fontWeight: "bold", color: "#0f172a", lineHeight: 30 },
            b: { fontSize: 11, color: "#94a3b8" },
          },
        },
        emphasis: { label: { show: true } },
        labelLine: { show: false },
        data: items.map((it) => ({
          name: it.name,
          value: it.value,
          itemStyle: { color: it.color },
        })),
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 240 }} />;
}

/** 20 年 FCF 推演 vs 折现现值 柱状图 */
export function FcfBars({ rows }: { rows: { year: number; fcf: number; pvFcf: number }[] }) {
  const option = {
    tooltip: { trigger: "axis" },
    legend: { data: ["自由现金流 FCF", "折现后现值 PV"], top: 0 },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: "category",
      data: rows.map((r) => `Y${r.year}`),
      axisLabel: { fontSize: 10 },
    },
    yAxis: { type: "value", name: "亿元" },
    series: [
      {
        name: "自由现金流 FCF",
        type: "bar",
        data: rows.map((r) => r.fcf.toFixed(1)),
        itemStyle: { color: "#4F46E5" },
      },
      {
        name: "折现后现值 PV",
        type: "bar",
        data: rows.map((r) => r.pvFcf.toFixed(1)),
        itemStyle: { color: "#A5B4FC" },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 300 }} />;
}

/**
 * 双轴趋势图：股价（左Y） + DCF 目标价（右Y，面积） + 置信区间带
 * @param prices 历史行情 [{ date, close }]
 * @param valuation 估值序列 [{ date, targetPrice }]，可为空
 * @param p5 置信区间下限（目标价）
 * @param p95 置信区间上限（目标价）
 */
export function TrendChart({
  prices,
  valuation = [],
  p5,
  p95,
}: {
  prices: { date: string; close: number }[];
  valuation?: { date: string; targetPrice: number }[];
  p5?: number;
  p95?: number;
}) {
  const dates = prices.map((p) => p.date);
  const closeData = prices.map((p) => p.close);

  // 估值数据对齐到 dates
  const valMap = new Map(valuation.map((v) => [v.date, v.targetPrice]));
  const valData = dates.map((d) => valMap.get(d) ?? null);

  // 置信区间带（若提供 p5/p95）
  const bandLower = p5 != null ? dates.map(() => p5) : [];
  const bandUpper = p95 != null ? dates.map(() => p95) : [];

  const option = {
    tooltip: { trigger: "axis" },
    legend: { data: ["收盘价", "DCF 目标价", "置信区间"], top: 0 },
    grid: { left: 55, right: 55, top: 40, bottom: 60 },
    xAxis: {
      type: "category",
      data: dates,
      axisLabel: { fontSize: 10, hideOverlap: true },
      boundaryGap: false,
    },
    yAxis: [
      {
        type: "value",
        name: "股价 (元)",
        position: "left",
        axisLabel: { fontSize: 10 },
      },
      {
        type: "value",
        name: "目标价 (元)",
        position: "right",
        axisLabel: { fontSize: 10 },
      },
    ],
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      { type: "slider", start: 0, end: 100, height: 20, bottom: 10 },
    ],
    series: [
      {
        name: "收盘价",
        type: "line",
        data: closeData,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#1E3A5F" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(30,58,95,0.25)" },
              { offset: 1, color: "rgba(30,58,95,0.02)" },
            ],
          },
        },
      },
      {
        name: "DCF 目标价",
        type: "line",
        yAxisIndex: 1,
        data: valData,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#10B981", type: "dashed" },
      },
      // 置信区间带（用两个面积图叠加实现）
      ...(p5 != null && p95 != null
        ? [
            {
              name: "置信上限",
              type: "line",
              yAxisIndex: 1,
              data: bandUpper,
              symbol: "none",
              lineStyle: { opacity: 0 },
              stack: "band",
              areaStyle: { color: "rgba(79,70,229,0.08)" },
              tooltip: { show: false },
              legendHoverLink: false,
            },
            {
              name: "置信区间",
              type: "line",
              yAxisIndex: 1,
              data: bandLower.map((v, i) => (bandUpper[i] ?? 0) - v),
              symbol: "none",
              lineStyle: { opacity: 0 },
              stack: "band",
              areaStyle: { color: "rgba(79,70,229,0.15)" },
            },
          ]
        : []),
    ],
  };

  return <ReactECharts option={option} style={{ height: 340 }} />;
}

/**
 * 蒙特卡洛置信区间分布图（直方图 + 当前市价标记线 + 分位线）
 * @param mc 蒙特卡洛结果
 * @param currentPrice 当前市价
 */
export function ConfidenceChart({
  mc,
  currentPrice,
}: {
  mc: MonteCarloResult;
  currentPrice: number;
}) {
  // 用 value 轴 + bar 实现直方图，便于 markLine 按数值精确定位
  const barData = mc.histogram.map((h) => [h.bin, h.count]);

  const option = {
    tooltip: {
      trigger: "axis",
      formatter: (params: { name: number; value: [number, number] }[]) => {
        const p = params[0];
        return `目标价: ¥${p.value[0].toFixed(2)}<br/>采样次数: ${p.value[1]}`;
      },
    },
    grid: { left: 55, right: 20, top: 30, bottom: 50 },
    xAxis: {
      type: "value",
      name: "目标价 (元)",
      min: "dataMin",
      max: "dataMax",
      axisLabel: { fontSize: 10 },
    },
    yAxis: { type: "value", name: "采样次数", axisLabel: { fontSize: 10 } },
    series: [
      {
        name: "频率",
        type: "bar",
        data: barData,
        barWidth: "90%",
        itemStyle: {
          color: (p: { value: [number, number] }) => {
            return p.value[0] < currentPrice ? "#EF4444" : "#10B981";
          },
        },
        markLine: {
          symbol: "none",
          silent: true,
          data: [
            {
              xAxis: currentPrice,
              lineStyle: { color: "#1E3A5F", width: 2.5, type: "solid" },
              label: {
                formatter: `市价 ¥${currentPrice.toFixed(2)} · ${mc.pricePercentile.toFixed(0)}分位`,
                position: "insideEndTop",
                color: "#1E3A5F",
                fontSize: 11,
                fontWeight: "bold",
              },
            },
          ],
        },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 280 }} />;
}
