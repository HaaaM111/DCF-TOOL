"use client";

import { memo, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { MonteCarloResult, ValueComposition } from "@/types/dcf";

export const ValueDonut = memo(function ValueDonut({ comp }: { comp: ValueComposition }) {
  const option = useMemo(() => {
    const items = [
      { name: "终值（20年后永续派现）", value: comp.terminal, color: "#244334" },
      { name: "显性期（前20年派现折现）", value: comp.explicit, color: "#315e49" },
      { name: "留存现金累积（按2%复利）", value: comp.retainedCash, color: "#a8a08c" },
      { name: "净现金 (+) / 净负债 (-)", value: comp.netCash, color: "#7d9488" },
    ];
    const total = comp.total || 1;

  return {
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
        itemStyle: { borderRadius: 4, borderColor: "#f7f8f6", borderWidth: 2 },
        label: {
          show: true,
          position: "center",
          formatter: [`{a|${total.toFixed(0)}}`, "{b|亿 · 股权价值}"].join("\n"),
          rich: {
            a: { fontSize: 22, fontWeight: "bold", color: "#202c26", lineHeight: 30 },
            b: { fontSize: 11, color: "#77817a" },
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
  }, [comp]);

  return <ReactECharts option={option} style={{ height: 240 }} notMerge lazyUpdate />;
});

export const FcfBars = memo(function FcfBars({ rows }: { rows: { year: number; fcf: number; pvFcf: number }[] }) {
  const option = useMemo(() => ({
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
        itemStyle: { color: "#315e49" },
      },
      {
        name: "折现后现值 PV",
        type: "bar",
        data: rows.map((r) => r.pvFcf.toFixed(1)),
        itemStyle: { color: "#9fb3a7" },
      },
    ],
  }), [rows]);
  return <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate />;
});

export const TrendChart = memo(function TrendChart({
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
  const option = useMemo(() => {
  const dates = prices.map((p) => p.date);
  const closeData = prices.map((p) => p.close);

  const valMap = new Map(valuation.map((v) => [v.date, v.targetPrice]));
  const valData = dates.map((d) => valMap.get(d) ?? null);

  const bandLower = p5 != null ? dates.map(() => p5) : [];
  const bandUpper = p95 != null ? dates.map(() => p95) : [];

  return {
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
        lineStyle: { width: 2, color: "#244334" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(36,67,52,0.25)" },
              { offset: 1, color: "rgba(36,67,52,0.02)" },
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
        lineStyle: { width: 2, color: "#315e49", type: "dashed" },
      },
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
              areaStyle: { color: "rgba(49,94,73,0.08)" },
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
              areaStyle: { color: "rgba(49,94,73,0.15)" },
            },
          ]
        : []),
    ],
  };
  }, [prices, valuation, p5, p95]);

  return <ReactECharts option={option} style={{ height: 340 }} lazyUpdate />;
});

export const ConfidenceChart = memo(function ConfidenceChart({
  mc,
  currentPrice,
}: {
  mc: MonteCarloResult;
  currentPrice: number;
}) {
  const option = useMemo(() => {
  const barData = mc.histogram.map((h) => [h.bin, h.count]);

  return {
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
            return p.value[0] < currentPrice ? "#9c5a4e" : "#315e49";
          },
        },
        markLine: {
          symbol: "none",
          silent: true,
          data: [
            {
              xAxis: currentPrice,
              lineStyle: { color: "#244334", width: 2.5, type: "solid" },
              label: {
                formatter: `市价 ¥${currentPrice.toFixed(2)} · ${mc.pricePercentile.toFixed(0)}分位`,
                position: "insideEndTop",
                color: "#244334",
                fontSize: 11,
                fontWeight: "bold",
              },
            },
          ],
        },
      },
    ],
  };
  }, [mc, currentPrice]);

  return <ReactECharts option={option} style={{ height: 280 }} notMerge lazyUpdate />;
});
