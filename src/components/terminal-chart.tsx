"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "@/app/providers";
import { terminalPalette } from "@/lib/terminal-palette";

function chartTheme(dark: boolean) {
  const palette = terminalPalette[dark ? "dark" : "light"];
  const { ink, muted, line, hover: grid } = palette;
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
    color: dark ? [palette.link, palette.positive, palette.warning, palette.negative, "#b3a6c0"]
      : [palette.link, "#6f897a", palette.warning, palette.negative, "#756682"],
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
