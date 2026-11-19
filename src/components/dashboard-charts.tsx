"use client";

interface ChartCompany {
  id: string;
  name: string;
  ticker: string;
  upside: number;
  originalUpside: number;
  impliedCagr: number;
  impliedL: number;
  netCash: number;
  marketCap: number;
}

const pct = (n: number, d = 0) =>
  Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(d)}%` : "—";

const ratioPct = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? (a / b) * 100 : NaN;

/** sqrt 压缩：极端标的（如 −1325%）不至于把其余标的压成一条线 */
const squash = (v: number, maxAbs: number) =>
  Math.sqrt(Math.min(Math.abs(v), maxAbs) / maxAbs) * 100;

/**
 * 全标的「潜在空间」排名条
 * 零轴居中，向左为负（红），向右为正（绿），宽度按 sqrt 压缩。
 */
export function UpsideRanking({ companies }: { companies: ChartCompany[] }) {
  const rows = [...companies]
    .filter((c) => Number.isFinite(c.upside))
    .sort((a, b) => b.upside - a.upside);
  if (!rows.length) return <p className="dash-empty">暂无估值快照</p>;

  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.upside)));

  return (
    <div className="rank-chart">
      <div className="rank-axis">
        <span className="rank-axis-label is-down">下行</span>
        <span className="rank-axis-label is-up">上行</span>
      </div>
      {rows.map((r) => {
        const up = r.upside >= 0;
        const w = squash(r.upside, maxAbs) / 2;
        return (
          <div className="rank-row" key={r.id}>
            <span className="rank-name">
              {r.name}
              <small>{r.ticker}</small>
            </span>
            <span className="rank-track">
              <i className="rank-zero" />
              <i
                className={`rank-bar ${up ? "is-up" : "is-down"}`}
                style={
                  up
                    ? { left: "50%", width: `${w}%` }
                    : { right: "50%", width: `${w}%` }
                }
              />
            </span>
            <span className={`rank-value ${up ? "is-up" : "is-down"}`}>
              {pct(r.upside, 1)}
              <em>{pct(r.originalUpside, 1)}</em>
            </span>
          </div>
        );
      })}
      <p className="rank-foot">
        条宽按 √ 压缩 · 大数值在原版正向 DCF 口径下为 {pct(
          Math.min(...rows.map((r) => r.originalUpside)),
          0,
        )}
      </p>
    </div>
  );
}

const METRICS = [
  {
    key: "upside" as const,
    label: "调整空间",
    format: (c: ChartCompany) => pct(c.upside, 1),
    value: (c: ChartCompany) => c.upside,
  },
  {
    key: "originalUpside" as const,
    label: "原版空间",
    format: (c: ChartCompany) => pct(c.originalUpside, 1),
    value: (c: ChartCompany) => c.originalUpside,
  },
  {
    key: "impliedCagr" as const,
    label: "隐含 CAGR",
    format: (c: ChartCompany) => pct(c.impliedCagr, 1),
    value: (c: ChartCompany) => c.impliedCagr,
  },
  {
    key: "impliedL" as const,
    label: "隐含 L",
    format: (c: ChartCompany) => pct(c.impliedL, 1),
    value: (c: ChartCompany) => c.impliedL,
  },
  {
    key: "cashRatio" as const,
    label: "净现金/市值",
    format: (c: ChartCompany) => pct(ratioPct(c.netCash, c.marketCap), 0),
    value: (c: ChartCompany) => ratioPct(c.netCash, c.marketCap),
  },
];

function tint(value: number, lo: number, hi: number): string {
  const span = Math.max(Math.abs(lo), Math.abs(hi), 1);
  const norm = Math.min(1, Math.abs(value) / span);
  const alpha = 0.04 + Math.pow(norm, 0.85) * 0.34;
  const rgb = value >= 0 ? "63,107,79" : "176,69,43";
  return `rgba(${rgb},${alpha.toFixed(3)})`;
}

/**
 * 全标的特征矩阵：每列独立按极值归一化着色，只看相对强弱，不做跨指标比较。
 */
export function FeatureMatrix({ companies }: { companies: ChartCompany[] }) {
  const rows = [...companies]
    .filter((c) => Number.isFinite(c.upside))
    .sort((a, b) => b.upside - a.upside);
  if (!rows.length) return <p className="dash-empty">暂无估值快照</p>;

  const scale = METRICS.map((m) => {
    const vals = rows.map((r) => m.value(r)).filter((v) => Number.isFinite(v));
    return { lo: Math.min(...vals, 0), hi: Math.max(...vals, 0) };
  });

  return (
    <div className="feature-matrix">
      <div className="fm-head">
        <span className="fm-name">标的</span>
        {METRICS.map((m) => (
          <span key={m.key} className="fm-col">
            {m.label}
          </span>
        ))}
      </div>
      {rows.map((r) => (
        <div className="fm-row" key={r.id}>
          <span className="fm-name">
            {r.name}
            <small>{r.ticker}</small>
          </span>
          {METRICS.map((m, i) => {
            const v = m.value(r);
            return (
              <span
                key={m.key}
                className="fm-cell"
                style={{ background: tint(v, scale[i].lo, scale[i].hi) }}
              >
                {m.format(r)}
              </span>
            );
          })}
        </div>
      ))}
      <p className="fm-foot">
        每列独立归一化 · 绿色为正向、红色为负向 · <i className="fm-swatch" /> 越深越极端
      </p>
    </div>
  );
}
