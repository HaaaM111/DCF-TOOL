import type { CSSProperties } from "react";

/**
 * 叙事分级诊断：不用整块彩色 Tag，只留「图标 + 文字」，
 * 需要重审的用警示三角 + 余烬橙，其余用中性小圆点，让这一列安静下来。
 */
function WarnIcon() {
  return (
    <svg
      className="diagnosis-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 2.6 14.2 13.4H1.8z" strokeWidth="1.1" />
      <path d="M8 6.4v3.4" strokeWidth="1.2" />
      <circle cx="8" cy="11.4" r="0.62" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function DiagnosisBadge({ value }: { value?: string | null }) {
  const text = (value ?? "").trim();
  if (!text || text === "-") {
    return <span className="diagnosis-badge is-empty">—</span>;
  }
  const warn = text.includes("需重审") || text.includes("透支");
  const cash = text.includes("现金");
  const style = { "--badge-tone": warn ? "warn" : cash ? "cash" : "neutral" } as CSSProperties;

  return (
    <span className="diagnosis-badge" data-tone={warn ? "warn" : cash ? "cash" : "neutral"} style={style}>
      {warn ? <WarnIcon /> : <i className="diagnosis-dot" aria-hidden="true" />}
      <span className="diagnosis-text">{text}</span>
    </span>
  );
}
