"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "@/app/providers";

function chartTheme(dark: boolean) {
  const ink = dark ? "#e2e8f0" : "#0f172a";
  const muted = dark ? "#8b9eb0" : "#475569";
  const line = dark ? "#2a3441" : "#dbe4ed";
  const grid = dark ? "#1e2533" : "#e2e8f0";
  const axis = {
    axisLine: { lineStyle: { color: line } },
    axisTick: { lineStyle: { color: line } },
    axisLabel: { color: muted, fontFamily: "Consolas, monospace" },
    nameTextStyle: { color: muted },
    splitLine: { lineStyle: { color: [grid], width: 1 } },
  };
  return {
    darkMode: dark,
    textStyle: { color: ink, fontFamily: 'Inter, "Segoe UI", sans-serif' },
    color: dark ? ["#60a5fa", "#34d399", "#fbbf24", "#fb7185", "#a78bfa"] : ["#2563eb", "#047857", "#b45309", "#be123c", "#6d28d9"],
    categoryAxis: axis,
    valueAxis: axis,
    timeAxis: axis,
    legend: { textStyle: { color: muted } },
    line: { symbol: "circle", symbolSize: 4, lineStyle: { width: 2 } },
    tooltip: { backgroundColor: grid, borderColor: line, borderWidth: 1, textStyle: { color: ink }, extraCssText: "box-shadow:none;border-radius:6px" },
  };
}

const darkTheme = chartTheme(true);
const lightTheme = chartTheme(false);

export default function TerminalChart(props: ComponentProps<typeof ReactECharts>) {
  const { mode } = useTheme();
  const chart = useRef<ReactECharts>(null);

  useEffect(() => {
    const element = chart.current?.getEchartsInstance().getDom();
    if (!element) return;
    const observer = new ResizeObserver(() => chart.current?.getEchartsInstance().resize());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <ReactECharts
      {...props}
      ref={chart}
      className={["terminal-chart", props.className].filter(Boolean).join(" ")}
      theme={mode === "dark" ? darkTheme : lightTheme}
      option={{ ...props.option, backgroundColor: "transparent", animation: false }}
    />
  );
}
