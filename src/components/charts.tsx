"use client";

import { useTheme } from "@/app/providers";
import { terminalPalette } from "@/lib/terminal-palette";
import ReactECharts from "@/components/terminal-chart";
import type { MonteCarloResult, ValueComposition } from "@/types/dcf";

/** 价值构成环形图（终值 / 显性期 / 留存现金 / 净现金） */
export function ValueDonut({ comp }: { comp: ValueComposition }) {
  const { mode } = useTheme();
  const palette = terminalPalette[mode];
  const items = [
    { name: "终值（20年后永续派现）", value: comp.terminal, color: palette.link },
    { name: "显性期（前20年派现折现）", value: comp.explicit, color: palette.divider },
    { name: "留存现金累积（按2%复利）", value: comp.retainedCash, color: palette.warning },
    { name: "净现金 (+) / 净负债 (-)", value: comp.netCash, color: palette.positive },
  ];
  const total = comp.total || 1;

  const option = {
    tooltip: {
      trigger: "item",
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>${p.value.toFixed(1)} 亿 (${p.percent}%)`,
    },
    legend: {
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 12,
      itemHeight: 12,
      textStyle: { fontSize: 12 },
    },
    series: [
      {
        name: "价值构成",
        type: "pie",
        radius: ["52%", "78%"],
        center: ["50%", "42%"],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 4, borderColor: "transparent", borderWidth: 2 },
        label: {
          show: true,
          position: "center",
          formatter: [`{a|${total.toFixed(0)}}`, "{b|亿 · 股权价值}"].join("\n"),
          rich: {
            a: { fontSize: 22, fontWeight: "bold", color: palette.ink, lineHeight: 30 },
            b: { fontSize: 11, color: palette.muted },
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

  return <ReactECharts option={option} style={{ height: 300 }} />;
}

/** 20 年 FCF 推演 vs 折现现值 柱状图 */
export function FcfBars({ rows }: { rows: { year: number; fcf: number; pvFcf: number }[] }) {
  const { mode } = useTheme();
  const palette = terminalPalette[mode];
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
        itemStyle: { color: palette.divider },
      },
      {
        name: "折现后现值 PV",
        type: "bar",
        data: rows.map((r) => r.pvFcf.toFixed(1)),
        itemStyle: { color: palette.positive },
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
  currency = "当地币",
}: {
  prices: { date: string; close: number }[];
  valuation?: { date: string; targetPrice: number | null }[];
  currency?: string;
}) {
  const { mode } = useTheme();
  const palette = terminalPalette[mode];
  const closeByDate = new Map(prices.map((p) => [p.date, p.close]));
  const sorted = [...valuation].sort((a, b) => a.date.localeCompare(b.date));
  const firstPriceDate = [...closeByDate.keys()].sort()[0];
  const dates = [...new Set([...closeByDate.keys(),
    ...sorted.filter((item) => !firstPriceDate || item.date >= firstPriceDate).map((item) => item.date)])].sort();
  const closeData = dates.map((date) => closeByDate.get(date) ?? null);
  let version = 0;
  let target: number | null = null;
  const valData = dates.map((date) => {
    while (version < sorted.length && sorted[version].date <= date) target = sorted[version++].targetPrice;
    return target;
  });

  const option = {
    tooltip: { trigger: "axis" },
    legend: { data: ["收盘价", ...(valData.some((value) => value !== null) ? ["已发布目标价"] : [])], top: 0 },
    grid: { left: 55, right: 30, top: 40, bottom: 60 },
    xAxis: {
      type: "category",
      data: dates,
      axisLabel: { fontSize: 10, hideOverlap: true },
      boundaryGap: false,
    },
    yAxis: { type: "value", name: `${currency}/股`, scale: true, axisLabel: { fontSize: 10 } },
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      { type: "slider", start: 0, end: 100, height: 20, bottom: 10 },
    ],
    series: [
      {
        name: "收盘价",
        type: "line",
        data: closeData,
        connectNulls: true,
        showSymbol: false,
        lineStyle: { width: 2, color: palette.accent }, itemStyle: { color: palette.accent },
      },
      {
        name: "已发布目标价",
        type: "line",
        data: valData,
        step: "end",
        symbol: "circle",
        lineStyle: { width: 2, color: palette.positive, type: "dashed" }, itemStyle: { color: palette.positive },
      },
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
  const { mode } = useTheme();
  const palette = terminalPalette[mode];
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
            return p.value[0] < currentPrice ? palette.negative : palette.positive;
          },
        },
        markLine: {
          symbol: "none",
          silent: true,
          data: [
            {
              xAxis: currentPrice,
              lineStyle: { color: palette.link, width: 2.5, type: "solid" },
              label: {
                formatter: `市价 ¥${currentPrice.toFixed(2)} · ${mc.pricePercentile.toFixed(0)}分位`,
                position: "insideEndTop",
                color: palette.link,
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
