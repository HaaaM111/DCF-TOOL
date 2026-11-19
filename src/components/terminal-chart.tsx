"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "@/app/providers";

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
      theme={mode === "dark" ? "dark" : undefined}
      option={{ ...props.option, backgroundColor: "transparent" }}
    />
  );
}
