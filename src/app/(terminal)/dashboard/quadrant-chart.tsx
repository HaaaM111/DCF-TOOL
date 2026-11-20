"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import dynamic from "next/dynamic";
import { useTheme } from "@/app/providers";
import { terminalPalette } from "@/lib/terminal-palette";
import styles from "./home.module.css";

const Chart = dynamic(() => import("@/components/terminal-chart"), { ssr: false,
  loading: () => <div role="status" className={styles.chartWaiting}>正在载入四象限图…</div> });

type Point = { id: string; name: string; x: number; y: number };

function range(values: number[], anchor: number) {
  const min = Math.min(anchor, ...values);
  const max = Math.max(anchor, ...values);
  const pad = Math.max(1, (max - min) * 0.13);
  return [Math.floor(min - pad), Math.ceil(max + pad)] as const;
}

export default function QuadrantChart({ points, selectedId, onSelect }: {
  points: Point[]; selectedId?: string; onSelect: (id: string) => void;
}) {
  const { mode } = useTheme();
  const palette = terminalPalette[mode];
  const option = useMemo<EChartsOption>(() => {
    const ordered = points.map(({ x }) => x).sort((a, b) => a - b);
    const median = ordered.length ? (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2 : 0;
    const [xMin, xMax] = ordered.length ? range(ordered, median) : [-10, 10];
    const [yMin, yMax] = ordered.length ? range(points.map(({ y }) => y), 0) : [-10, 10];
    const axisLabel = { color: palette.muted, formatter: "{value}%", hideOverlap: true };
    return {
      grid: { left: 52, right: 18, top: 18, bottom: 54 },
      xAxis: {
        type: "value", min: xMin, max: xMax, splitNumber: 4, axisLabel, axisLine: { onZero: false, show: true },
        name: points.length ? `市场隐含 CAGR · 中位数 ${median.toFixed(1)}%` : "市场隐含 CAGR（%）",
        nameLocation: "middle", nameGap: 34,
      },
      yAxis: {
        type: "value", min: yMin, max: yMax, splitNumber: 4, axisLabel, axisLine: { onZero: false, show: true },
        splitLine: { lineStyle: { type: "dashed", color: palette.line } },
      },
      tooltip: {
        trigger: "item", confine: true, renderMode: "richText",
        formatter: (info) => {
          if (Array.isArray(info) || !Array.isArray(info.value)) return "";
          const [x, y] = info.value as number[];
          return `${info.name}\n市场隐含 CAGR：${x.toFixed(1)}%\n同日潜在空间：${y.toFixed(1)}%`;
        },
      },
      series: [{
        type: "scatter", emphasis: { scale: 1.15 },
        data: points.map(({ x, y, id, name }) => ({
          id, name, value: [x, y], symbolSize: id === selectedId ? 17 : 11,
          itemStyle: { color: y < 0 ? palette.negative : palette.positive,
            opacity: id === selectedId ? 1 : 0.68, borderColor: palette.ink, borderWidth: id === selectedId ? 1.75 : 0 },
          label: { show: id === selectedId, formatter: "{b}", position: "top", color: palette.ink, fontWeight: 600 },
        })),
        markArea: { silent: true, label: { show: false }, data: [
          [{ coord: [xMin, 0], itemStyle: { color: palette.chartUp } }, { coord: [xMax, yMax] }],
          [{ coord: [xMin, yMin], itemStyle: { color: palette.chartDown } }, { coord: [xMax, 0] }],
        ] },
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { type: "solid", color: palette.divider }, data: [{ xAxis: median }, { yAxis: 0 }] },
      }],
    };
  }, [points, selectedId, palette]);

  if (!points.length) return <div className={styles.chartWaiting}><strong>暂无可比较的标的</strong><span>标的同时具备市场隐含增长率和同日潜在空间后，将在这里显示。</span></div>;
  return <div className={styles.chart} role="group" aria-label="横轴为市场隐含增长率，纵轴为同日潜在空间">
    <span className={styles.axisTitle}>同日潜在空间（%）</span>
    <Chart option={option} style={{ height: "100%", width: "100%" }} onEvents={{ click: ({ data }: { data?: { id?: string } }) => { if (data?.id) onSelect(data.id); } }} />
  </div>;
}
