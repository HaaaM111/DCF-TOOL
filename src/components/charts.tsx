"use client";

import { useMemo, useState } from "react";
import { Segmented } from "antd";
import { aggregatePriceBars, type PriceBar, type PricePeriod } from "@/lib/price-candles";
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

/** Plot verified OHLC for each period and align effective targets to the last traded day. */
export function TrendChart({ prices, valuation = [], currency = "当地币" }: {
  prices: PriceBar[];
  valuation?: { date: string; targetPrice: number | null }[];
  currency?: string;
}) {
  const { mode } = useTheme();
  const palette = terminalPalette[mode];
  const [period, setPeriod] = useState<PricePeriod>("day");
  const bars = useMemo(() => aggregatePriceBars(prices, period), [prices, period]);
  const dates = bars.map(({ date }) => date);
  const periods = { day: "日 K", week: "周 K", month: "月 K" };
  const hasCandles = bars.some((bar) => bar.candle);
  const hasCloseOnly = bars.some((bar) => !bar.candle);
  const sorted = [...valuation].sort((a, b) => a.date.localeCompare(b.date));
  let version = 0;
  let target: number | null = null;
  const valData = dates.map((date) => {
    while (version < sorted.length && sorted[version].date <= date) target = sorted[version++].targetPrice;
    return target;
  });
  const hasTargets = valData.some((value) => value !== null);
  const showBars = period === "day" ? 120 : period === "week" ? 62 : bars.length;
  const zoomStart = Math.max(0, 100 - showBars / Math.max(1, bars.length) * 100);
  const series = [
    ...(hasCandles ? [{
      name: periods[period], type: "candlestick", data: bars.map((bar) => bar.candle ?? "-"),
      itemStyle: { color: palette.positive, color0: palette.negative, borderColor: palette.positive, borderColor0: palette.negative },
    }] : []),
    ...(hasCloseOnly ? [{
      name: "仅收盘价", type: hasCandles ? "scatter" : "line",
      data: bars.map((bar) => bar.candle ? null : bar.close),
      showSymbol: hasCandles, symbolSize: 5, itemStyle: { color: palette.accent },
    }] : []),
    ...(hasTargets ? [{
      name: "已发布目标价", type: "line", data: valData, step: "end", showSymbol: false,
      lineStyle: { width: 2, color: palette.link, type: "dashed" }, itemStyle: { color: palette.link },
    }] : []),
  ];
  const showPrice = (value: number) => value.toFixed(2);
  const option = {
    tooltip: {
      trigger: "axis",
      formatter: (items: { dataIndex: number }[]) => {
        const index = items[0]?.dataIndex;
        const bar = bars[index];
        if (!bar) return "";
        const range = bar.firstDate === bar.date ? bar.date : `${bar.firstDate} 至 ${bar.date}`;
        const values = bar.candle
          ? `开 ${showPrice(bar.candle[0])}　高 ${showPrice(bar.candle[3])}　低 ${showPrice(bar.candle[2])}　收 ${showPrice(bar.close)}`
          : `收盘 ${showPrice(bar.close)}`;
        const targetPrice = valData[index];
        return `${range}<br/>${values} ${currency}${targetPrice == null ? "" : `<br/>已发布目标价 ${showPrice(targetPrice)} ${currency}`}`;
      },
    },
    legend: { data: series.map(({ name }) => name), top: 0 },
    grid: { left: 55, right: 25, top: 42, bottom: 58 },
    xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10, hideOverlap: true, formatter: (date: string) =>
      period === "month" ? date.slice(0, 7) : date }, boundaryGap: true },
    yAxis: { type: "value", name: `${currency}/股`, scale: true, axisLabel: { fontSize: 10 } },
    dataZoom: [
      { type: "inside", start: zoomStart, end: 100 },
      { type: "slider", start: zoomStart, end: 100, height: 20, bottom: 10 },
    ],
    series,
  };

  return <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Segmented<PricePeriod> aria-label="股价周期" value={period} onChange={setPeriod}
        options={Object.entries(periods).map(([value, label]) => ({ value: value as PricePeriod, label }))} />
      <span className="text-xs text-terminal-muted">
        {hasCloseOnly ? "开高低缺失的区间仅显示收盘价" : "未复权 · 周/月以最后交易日收盘为准"}
      </span>
    </div>
    <ReactECharts key={period} option={option} style={{ height: 340 }} />
  </>;
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
