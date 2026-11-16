"use client";

import { memo, useId, useMemo } from "react";
import { useTheme } from "@/app/providers";

export interface QuadrantCompany {
  id: string;
  name: string;
  ticker: string;
  currentPrice: number;
  targetPrice: number;
  upside: number;
  impliedCagr: number;
  quadrant: string;
  marketCap?: number;
}

export type QuadrantView = "expectation" | "marketCap" | "price";

export const QUADRANT_VIEWS: { key: QuadrantView; label: string }[] = [
  { key: "expectation", label: "预期 × 空间" },
  { key: "marketCap", label: "市值 × 空间" },
  { key: "price", label: "股价 × 空间" },
];

function compactMarketCap(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万亿`;
  return `${Math.round(value).toLocaleString("zh-CN")}亿`;
}

const QUADRANT_CONFIG: Record<
  QuadrantView,
  {
    xLabel: string;
    xValue: (company: QuadrantCompany) => number;
    inverseX: (value: number) => number;
    xTick: (value: number) => string;
    xMedian: (value: number) => string;
    quadrants: [string, string, string, string];
  }
> = {
  expectation: {
    xLabel: "市场隐含 CAGR（%）",
    xValue: (company) => company.impliedCagr,
    inverseX: (value) => value,
    xTick: (value) => `${value.toFixed(0)}%`,
    xMedian: (value) => `${value.toFixed(1)}%`,
    quadrants: ["低预期 · 高空间", "高预期 · 高空间", "低预期 · 低空间", "高预期 · 低空间"],
  },
  marketCap: {
    xLabel: "总市值（亿元，对数轴）",
    xValue: (company) =>
      company.marketCap && company.marketCap > 0 ? Math.log10(company.marketCap) : Number.NaN,
    inverseX: (value) => 10 ** value,
    xTick: (value) => compactMarketCap(10 ** value),
    xMedian: (value) => compactMarketCap(value),
    quadrants: ["小市值 · 高空间", "大市值 · 高空间", "小市值 · 低空间", "大市值 · 低空间"],
  },
  price: {
    xLabel: "最新市价（元）",
    xValue: (company) => company.currentPrice,
    inverseX: (value) => value,
    xTick: (value) => `¥${value.toFixed(0)}`,
    xMedian: (value) => `¥${value.toFixed(2)}`,
    quadrants: ["低价 · 高空间", "高价 · 高空间", "低价 · 低空间", "高价 · 低空间"],
  },
};

interface PricePoint {
  date: string;
  close: number;
}

interface ValuationPoint {
  date: string;
  targetPrice: number;
}

interface Point {
  x: number;
  y: number;
}

function useChartColors() {
  const { resolvedMode } = useTheme();
  return {
    dark: resolvedMode === "dark",
    text: resolvedMode === "dark" ? "#b8b8b1" : "#494944",
    muted: resolvedMode === "dark" ? "#87877f" : "#74746d",
    line: resolvedMode === "dark" ? "#353531" : "#e2e2dc",
    strong: resolvedMode === "dark" ? "#8db2a0" : "#315e49",
    deep: resolvedMode === "dark" ? "#6c9080" : "#244334",
    red: resolvedMode === "dark" ? "#c08a7c" : "#9c5a4e",
    paper: resolvedMode === "dark" ? "#232321" : "#ffffff",
    greenArea: resolvedMode === "dark" ? "rgba(141,178,160,0.08)" : "rgba(49,94,73,0.05)",
    redArea: resolvedMode === "dark" ? "rgba(192,138,124,0.06)" : "rgba(156,90,78,0.04)",
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function scale(value: number, min: number, max: number, start: number, end: number) {
  return start + ((value - min) / (max - min || 1)) * (end - start);
}

function tickValues(min: number, max: number, count = 5) {
  return Array.from({ length: count }, (_, index) =>
    min + ((max - min) * index) / (count - 1),
  );
}

function linePath(points: Point[]) {
  return points
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
}

function paddedDomain(values: number[], minimumRange: number) {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const range = Math.max(dataMax - dataMin, minimumRange);
  return {
    min: dataMin - range * 0.16,
    max: dataMax + range * 0.16,
  };
}

function activateOnKey(event: React.KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

export const WatchlistQuadrant = memo(function WatchlistQuadrant({
  companies,
  selectedId,
  onSelect,
  view = "expectation",
}: {
  companies: QuadrantCompany[];
  selectedId?: string;
  onSelect: (id: string) => void;
  view?: QuadrantView;
}) {
  const colors = useChartColors();
  const config = QUADRANT_CONFIG[view];
  const validCompanies = useMemo(
    () =>
      companies.filter(
        (company) =>
          Number.isFinite(config.xValue(company)) && Number.isFinite(company.upside),
      ),
    [companies, config],
  );

  const chart = useMemo(() => {
    if (!validCompanies.length) return null;
    const width = 720;
    const height = 390;
    const plot = { left: 76, right: 696, top: 24, bottom: 326 };
    const xs = validCompanies.map((company) => config.xValue(company));
    const ys = validCompanies.map((company) => company.upside);
    const splitX = median(xs);
    const xDomain = paddedDomain([...xs, splitX], view === "marketCap" ? 0.35 : 5);
    const yDomain = paddedDomain([...ys, 0], 20);
    const x = (value: number) => scale(value, xDomain.min, xDomain.max, plot.left, plot.right);
    const y = (value: number) => scale(value, yDomain.min, yDomain.max, plot.bottom, plot.top);
    const splitPx = x(splitX);
    const zeroPy = y(0);
    return { width, height, plot, splitX, xDomain, yDomain, x, y, splitPx, zeroPy };
  }, [config, validCompanies, view]);

  if (!chart) return <div className="chart-empty">暂无数据</div>;

  const { width, height, plot, splitX, xDomain, yDomain, x, y, splitPx, zeroPy } = chart;
  const [topLeft, topRight, bottomLeft, bottomRight] = config.quadrants;
  const quadrantLabels = [
    { text: topLeft, x: plot.left + 12, y: plot.top + 20, anchor: "start" as const },
    { text: topRight, x: plot.right - 12, y: plot.top + 20, anchor: "end" as const },
    { text: bottomLeft, x: plot.left + 12, y: plot.bottom - 12, anchor: "start" as const },
    { text: bottomRight, x: plot.right - 12, y: plot.bottom - 12, anchor: "end" as const },
  ];
  const viewLabel = QUADRANT_VIEWS.find((item) => item.key === view)?.label ?? "";

  return (
    <svg
      className="svg-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`自选标的${viewLabel}四象限，横轴为${config.xLabel}，纵轴为调整后潜在空间`}
    >
      <rect x={plot.left} y={plot.top} width={splitPx - plot.left} height={zeroPy - plot.top} fill={colors.greenArea} />
      <rect x={splitPx} y={plot.top} width={plot.right - splitPx} height={zeroPy - plot.top} fill={colors.greenArea} />
      <rect x={plot.left} y={zeroPy} width={splitPx - plot.left} height={plot.bottom - zeroPy} fill={colors.redArea} />
      <rect x={splitPx} y={zeroPy} width={plot.right - splitPx} height={plot.bottom - zeroPy} fill={colors.redArea} />

      {tickValues(yDomain.min, yDomain.max).map((tick) => (
        <g key={`y-${tick}`}>
          <line x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} stroke={colors.line} strokeDasharray="3 4" />
          <text x={plot.left - 10} y={y(tick) + 4} textAnchor="end" fill={colors.muted} fontSize="10">
            {tick.toFixed(0)}%
          </text>
        </g>
      ))}
      {tickValues(xDomain.min, xDomain.max).map((tick, index) => (
        <text key={`x-${view}-${index}`} x={x(tick)} y={plot.bottom + 25} textAnchor="middle" fill={colors.muted} fontSize="10">
          {config.xTick(tick)}
        </text>
      ))}

      <line x1={splitPx} x2={splitPx} y1={plot.top} y2={plot.bottom} stroke={colors.muted} />
      <line x1={plot.left} x2={plot.right} y1={zeroPy} y2={zeroPy} stroke={colors.muted} />
      <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke={colors.line} />
      <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} stroke={colors.line} />

      {quadrantLabels.map((label) => (
        <text key={label.text} x={label.x} y={label.y} textAnchor={label.anchor} fill={colors.muted} fontSize="11" fontWeight="500">
          {label.text}
        </text>
      ))}
      <text x={(plot.left + plot.right) / 2} y={height - 10} textAnchor="middle" fill={colors.muted} fontSize="11">
        {config.xLabel} · 中位数 {config.xMedian(config.inverseX(splitX))}
      </text>
      <text x={16} y={(plot.top + plot.bottom) / 2} textAnchor="middle" fill={colors.muted} fontSize="11" transform={`rotate(-90 16 ${(plot.top + plot.bottom) / 2})`}>
        调整后潜在空间（%）
      </text>

      {validCompanies.map((company) => {
        const cx = x(config.xValue(company));
        const cy = y(company.upside);
        const selected = company.id === selectedId;
        const xDetail =
          view === "marketCap"
            ? `总市值 ${compactMarketCap(company.marketCap ?? 0)}`
            : view === "price"
              ? `最新市价 ¥${company.currentPrice.toFixed(2)}`
              : `隐含 CAGR ${company.impliedCagr.toFixed(1)}%`;
        const tooltip = `${company.name} ${company.ticker}\n${xDetail}\n潜在空间 ${company.upside.toFixed(1)}%\n目标价 ¥${company.targetPrice.toFixed(2)}\n${company.quadrant || "尚未生成象限诊断"}`;
        return (
          <g
            key={company.id}
            role="button"
            tabIndex={0}
            aria-label={`选择${company.name}，${tooltip}`}
            style={{ cursor: "pointer", outline: "none" }}
            onClick={() => onSelect(company.id)}
            onKeyDown={(event) => activateOnKey(event, () => onSelect(company.id))}
          >
            <title>{tooltip}</title>
            <circle cx={cx} cy={cy} r={selected ? 14 : 10} fill="transparent" />
            <circle
              cx={cx}
              cy={cy}
              r={selected ? 8 : 5.5}
              fill={company.quadrant.includes("红灯") ? colors.red : colors.strong}
              stroke={selected ? colors.deep : colors.paper}
              strokeWidth={selected ? 3 : 1}
              opacity={selectedId && !selected ? 0.58 : 0.96}
            />
            {selected && (
              <text x={cx} y={cy - 15} textAnchor="middle" fill={colors.text} fontSize="12" fontWeight="600">
                {company.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});

export const UpsideComparison = memo(function UpsideComparison({
  companies,
  selectedId,
  onSelect,
}: {
  companies: QuadrantCompany[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const colors = useChartColors();
  const sorted = useMemo(
    () => [...companies].sort((a, b) => a.upside - b.upside),
    [companies],
  );

  if (!sorted.length) return <div className="chart-empty">暂无估值对比数据</div>;

  const width = 520;
  const height = Math.max(330, sorted.length * 46 + 66);
  const plot = { left: 106, right: 462, top: 22, bottom: height - 48 };
  const values = sorted.map((company) => company.upside);
  const domain = paddedDomain([...values, 0], 10);
  const x = (value: number) => scale(value, domain.min, domain.max, plot.left, plot.right);
  const zeroX = x(0);
  const rowHeight = (plot.bottom - plot.top) / sorted.length;

  return (
    <svg
      className="svg-chart"
      viewBox={`0 0 ${width} ${height}`}
      style={{ height }}
      role="img"
      aria-label="自选标的 DCF 潜在空间对比"
    >
      {tickValues(domain.min, domain.max).map((tick) => (
        <g key={tick}>
          <line x1={x(tick)} x2={x(tick)} y1={plot.top} y2={plot.bottom} stroke={colors.line} strokeDasharray="3 4" />
          <text x={x(tick)} y={plot.bottom + 22} textAnchor="middle" fill={colors.muted} fontSize="10">
            {tick.toFixed(0)}%
          </text>
        </g>
      ))}
      <line x1={zeroX} x2={zeroX} y1={plot.top} y2={plot.bottom} stroke={colors.muted} />
      <text x={(plot.left + plot.right) / 2} y={height - 8} textAnchor="middle" fill={colors.muted} fontSize="11">
        调整后潜在空间（%）
      </text>

      {sorted.map((company, index) => {
        const cy = plot.top + rowHeight * index + rowHeight / 2;
        const valueX = x(company.upside);
        const selected = company.id === selectedId;
        const positive = company.upside >= 0;
        const tooltip = `${company.name}\n潜在空间 ${company.upside >= 0 ? "+" : ""}${company.upside.toFixed(1)}%\n目标价 ¥${company.targetPrice.toFixed(2)}`;
        return (
          <g
            key={company.id}
            role="button"
            tabIndex={0}
            aria-label={`选择${company.name}，${tooltip}`}
            style={{ cursor: "pointer", outline: "none" }}
            onClick={() => onSelect(company.id)}
            onKeyDown={(event) => activateOnKey(event, () => onSelect(company.id))}
          >
            <title>{tooltip}</title>
            <rect x={0} y={cy - rowHeight / 2} width={width} height={rowHeight} fill="transparent" />
            <text x={plot.left - 12} y={cy + 4} textAnchor="end" fill={selected ? colors.deep : colors.text} fontSize="11" fontWeight={selected ? 600 : 400}>
              {company.name}
            </text>
            <rect
              x={Math.min(zeroX, valueX)}
              y={cy - Math.min(9, rowHeight * 0.26)}
              width={Math.max(Math.abs(valueX - zeroX), 1.5)}
              height={Math.min(18, rowHeight * 0.52)}
              rx={2}
              fill={positive ? colors.strong : colors.red}
              stroke={selected ? colors.deep : "transparent"}
              strokeWidth={selected ? 2 : 0}
              opacity={selectedId && !selected ? 0.58 : 0.96}
            />
            <text
              x={valueX + (positive ? 7 : -7)}
              y={cy + 4}
              textAnchor={positive ? "start" : "end"}
              fill={positive ? colors.strong : colors.red}
              fontSize="10"
              fontWeight="500"
            >
              {positive ? "+" : ""}{company.upside.toFixed(1)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
});

export const PriceTargetChart = memo(function PriceTargetChart({
  prices,
  valuation = [],
  targetPrice,
}: {
  prices: PricePoint[];
  valuation?: ValuationPoint[];
  targetPrice: number;
}) {
  const colors = useChartColors();
  const gradientId = `price-area-${useId().replace(/:/g, "")}`;

  const chart = useMemo(() => {
    const dates = Array.from(
      new Set([...prices.map((point) => point.date), ...valuation.map((point) => point.date)]),
    ).sort();
    if (!dates.length) return null;

    const width = 720;
    const height = 340;
    const plot = { left: 62, right: 698, top: 44, bottom: 272 };
    const allValues = [
      ...prices.map((point) => point.close),
      ...valuation.map((point) => point.targetPrice),
      ...(Number.isFinite(targetPrice) ? [targetPrice] : []),
    ];
    const domain = paddedDomain(allValues.length ? allValues : [0, 1], 1);
    const x = (date: string) =>
      scale(dates.indexOf(date), 0, Math.max(dates.length - 1, 1), plot.left, plot.right);
    const y = (value: number) => scale(value, domain.min, domain.max, plot.bottom, plot.top);
    const closePoints = prices.map((point) => ({ x: x(point.date), y: y(point.close) }));
    const valuationPoints = valuation.map((point) => ({
      x: x(point.date),
      y: y(point.targetPrice),
      date: point.date,
      value: point.targetPrice,
    }));
    return { width, height, plot, dates, domain, x, y, closePoints, valuationPoints };
  }, [prices, valuation, targetPrice]);

  if (!chart) {
    return <div className="chart-empty">暂无历史行情，展示最新估值结果后可继续复盘</div>;
  }

  const { width, height, plot, dates, domain, x, y, closePoints, valuationPoints } = chart;
  const closePath = linePath(closePoints);
  const areaPath = closePoints.length
    ? `${linePath([{ x: closePoints[0].x, y: plot.bottom }, ...closePoints, { x: closePoints.at(-1)!.x, y: plot.bottom }])} Z`
    : "";
  const lastPrice = prices.at(-1);
  const targetY = y(targetPrice);

  return (
    <svg
      className="svg-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="近 180 个交易日的收盘价与 DCF 目标价走势"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.strong} stopOpacity={colors.dark ? 0.22 : 0.18} />
          <stop offset="100%" stopColor={colors.strong} stopOpacity="0.01" />
        </linearGradient>
      </defs>

      <line x1={plot.left} x2={plot.left + 22} y1={17} y2={17} stroke={colors.deep} strokeWidth={2.2} />
      <text x={plot.left + 29} y={21} fill={colors.muted} fontSize="11">收盘价</text>
      <line x1={plot.left + 100} x2={plot.left + 122} y1={17} y2={17} stroke={colors.strong} strokeWidth={2} strokeDasharray="5 4" />
      <text x={plot.left + 129} y={21} fill={colors.muted} fontSize="11">历史 DCF 目标价</text>

      {tickValues(domain.min, domain.max).map((tick) => (
        <g key={tick}>
          <line x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} stroke={colors.line} strokeDasharray="3 4" />
          <text x={plot.left - 10} y={y(tick) + 4} textAnchor="end" fill={colors.muted} fontSize="10">
            {Math.abs(tick) >= 10 ? tick.toFixed(0) : tick.toFixed(1)}
          </text>
        </g>
      ))}
      {tickValues(0, Math.max(dates.length - 1, 1)).map((tick) => {
        const index = Math.round(tick);
        const date = dates[index];
        return (
          <text key={`${date}-${index}`} x={scale(index, 0, Math.max(dates.length - 1, 1), plot.left, plot.right)} y={plot.bottom + 27} textAnchor="middle" fill={colors.muted} fontSize="10">
            {date?.slice(5)}
          </text>
        );
      })}
      <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke={colors.line} />
      <text x={plot.left - 42} y={plot.top - 17} fill={colors.muted} fontSize="10">元 / 股</text>

      {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
      {closePath && (
        <path d={closePath} fill="none" stroke={colors.deep} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round">
          <title>收盘价</title>
        </path>
      )}
      {valuationPoints.length > 0 && (
        <path d={linePath(valuationPoints)} fill="none" stroke={colors.strong} strokeWidth={1.8} strokeDasharray="6 4" strokeLinejoin="round">
          <title>历史 DCF 目标价</title>
        </path>
      )}
      {valuationPoints.map((point) => (
        <circle key={`${point.date}-${point.value}`} cx={point.x} cy={point.y} r={4} fill={colors.strong}>
          <title>{point.date} · DCF 目标价 ¥{point.value.toFixed(2)}</title>
        </circle>
      ))}
      {Number.isFinite(targetPrice) && (
        <g>
          <line x1={plot.left} x2={plot.right} y1={targetY} y2={targetY} stroke={colors.red} strokeWidth={1.4} strokeDasharray="7 5" />
          <text x={plot.right - 4} y={targetY - 8} textAnchor="end" fill={colors.red} fontSize="10">
            当前目标价 ¥{targetPrice.toFixed(2)}
          </text>
        </g>
      )}
      {lastPrice && (
        <circle cx={x(lastPrice.date)} cy={y(lastPrice.close)} r={4.5} fill={colors.deep} stroke={colors.paper} strokeWidth={1.5}>
          <title>{lastPrice.date} · 收盘价 ¥{lastPrice.close.toFixed(2)}</title>
        </circle>
      )}
    </svg>
  );
});
