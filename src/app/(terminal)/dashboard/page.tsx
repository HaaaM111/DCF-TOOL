"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRightOutlined, ExportOutlined, ReloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import type { PrimaryValuation } from "@/lib/primary-valuation";
import { useWorkspace } from "@/app/providers";
import { MARKET_NEWS_POLL_MS, MARKET_NEWS_SOURCES, marketNewsBatch, type MarketNewsFeed, type MarketNewsItem } from "@/lib/market-news";
import QuadrantChart from "./quadrant-chart";
import styles from "./home.module.css";

interface Company {
  id: string;
  name: string;
  ticker: string;
  currentPrice: number;
  impliedCagr?: number;
  impliedLE3?: number;
  lastEvalDate?: string | null;
  primaryValuation: PrimaryValuation;
}

type LoadState = "loading" | "ready" | "error";
const shortcuts = [
  { href: "/valuation/board", label: "估值看板" },
  { href: "/announcements", label: "公告中心" },
  { href: "/agent", label: "智能体对话" },
];
const formatDate = (value: string, time = false) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit",
    ...(time ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(date);
};
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
const currencyOf = (ticker: string) => /\.HK$/i.test(ticker) ? "HKD" : /\.(SH|SZ|BJ)$/i.test(ticker) ? "CNY" : "";
const price = (value: number | null, currency: string) => value !== null && Number.isFinite(value)
  ? new Intl.NumberFormat("zh-CN", currency ? { style: "currency", currency, currencyDisplay: "narrowSymbol" }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  : "—";

function NewsCard({ item, rank, lead }: { item: MarketNewsItem; rank: number; lead?: boolean }) {
  return <a className={`${styles.article} ${lead ? styles.lead : ""}`} href={item.url}
    target="_blank" rel="noopener noreferrer">
    <div className={styles.articleTop}>
      <span className={styles.rank} aria-hidden="true">{rank}</span>
      <time className={styles.byline} dateTime={item.publishAt}>{formatDate(item.publishAt, true)}</time>
      <ExportOutlined aria-hidden="true" />
    </div>
    <p>{item.title}</p>
    <span className={styles.srOnly}>（在新标签页打开{MARKET_NEWS_SOURCES[item.source].label}原文）</span>
  </a>;
}

async function readList<T>(url: string, key: string, signal: AbortSignal): Promise<T[]> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data?.[key])) throw new Error("Invalid list response");
  return data[key];
}

export default function DashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [feed, setFeed] = useState<MarketNewsFeed>();
  const [batch, setBatch] = useState(0);
  const news = feed ? marketNewsBatch(feed.items, batch) : [];
  const [companyState, setCompanyState] = useState<LoadState>("loading");
  const [newsState, setNewsState] = useState<LoadState>("loading");
  const [selectedId, setSelectedId] = useState<string>();
  const { preferences: { autoRefreshNews } } = useWorkspace();

  const loadNews = useCallback(async (signal?: AbortSignal, manual = false) => {
    if (manual) setNewsState("loading");
    try {
      const timeout = AbortSignal.timeout(10_000);
      const response = await fetch("/api/market-news", { cache: "no-store",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!response.ok) throw new Error("News unavailable");
      const data: MarketNewsFeed = await response.json();
      if (!signal?.aborted) {
        setFeed(data);
        setNewsState(data.stale ? "error" : "ready");
      }
    } catch {
      if (!signal?.aborted) setNewsState("error");
    }
  }, []);

  function rotateNews() {
    setBatch((previous) => previous + 1);
    void loadNews(undefined, true);
  }

  useEffect(() => {
    const controller = new AbortController();
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void loadNews(controller.signal);
    };
    void loadNews(controller.signal);
    if (!autoRefreshNews) return () => controller.abort();
    const timer = window.setInterval(refreshVisible, MARKET_NEWS_POLL_MS);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [loadNews, autoRefreshNews]);

  useEffect(() => {
    const controller = new AbortController();
    void readList<Company>("/api/companies", "companies", AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]))
      .then((data) => { if (!controller.signal.aborted) { setCompanies(data); setCompanyState("ready"); } })
      .catch(() => { if (!controller.signal.aborted) setCompanyState("error"); });
    return () => controller.abort();
  }, []);

  const selected = companies.find((company) => company.id === selectedId) ?? companies[0];
  const latestDate = companies.flatMap((company) => company.primaryValuation.kind === "operating"
    ? [company.primaryValuation.publication.valuationDate] : company.lastEvalDate ? [company.lastEvalDate] : []).sort().at(-1);
  const primary = selected?.primaryValuation;
  const upside = primary?.upside ?? null;
  const points = companies.flatMap((company) => {
    const x = company.impliedCagr;
    const y = company.primaryValuation.upside;
    // The reverse model returns 0 as a placeholder when its growth calculation is unavailable.
    return x !== undefined && Number.isFinite(x) && (company.impliedLE3 ?? 0) > 0 && y !== null && Number.isFinite(y)
      ? [{ id: company.id, name: company.name, x, y }] : [];
  });
  const featured = news.slice(0, 6);

  return <div className={styles.page}>
    <section className={styles.news} aria-labelledby="news-title" aria-busy={newsState === "loading"}>
      <div className={styles.meta}><span>{companyState === "ready" ? `${companies.length} 个标的` : "自选标的"}</span><span>最近估值 {latestDate ? formatDate(latestDate) : "—"}</span></div>
      <div className={styles.newsHead}>
        <div><h1 id="news-title">实时资讯</h1><p>7×24 财经快讯 · {autoRefreshNews ? "每分钟同步" : "手动刷新"}{feed && <> · {formatDate(feed.updatedAt, true)}</>}</p></div>
        <button type="button" title="换一批快讯并检查更新" disabled={newsState === "loading"} onClick={rotateNews}>
          <ReloadOutlined aria-hidden="true" spin={newsState === "loading"} /> 换一批
        </button>
      </div>
      {featured.length > 0 ? <div className={styles.newsGrid}>
        {featured.map((item, index) => <NewsCard key={item.id} item={item} rank={index + 1} lead={index === 0} />)}
      </div> : <div className={styles.newsEmpty} role="status">
        <strong>{newsState === "loading" ? "正在读取财经快讯…" : newsState === "error" ? "暂时无法读取资讯" : "暂无财经快讯"}</strong>
        {newsState !== "loading" && <p>{newsState === "error" ? "可点击右上角刷新重试。" : "稍后将自动刷新。"}</p>}
      </div>}
      {!!featured.length && newsState === "error" && <p className={styles.stale} role="status">暂时无法同步，仍可浏览已加载的快讯。</p>}
    </section>

    <div className={styles.workspace}>
      <section className={styles.market} aria-labelledby="quadrant-title">
        <div className={styles.snapshot}>
          <div className={styles.ticker}>
            <div><strong>{selected?.name ?? "标的快照"}</strong>
              {selected && <Link href={`/company/${encodeURIComponent(selected.ticker)}`}>报告 <ArrowRightOutlined /></Link>}
            </div>
            <span>{selected?.ticker ?? (companyState === "loading" ? "正在载入" : companyState === "error" ? "标的读取失败" : "暂无自选标的")}</span>
          </div>
          <dl className={styles.metrics}>
            <div><dt>档案行情</dt><dd>{selected ? price(selected.currentPrice, currencyOf(selected.ticker)) : "—"}</dd></div>
            <div><dt>DCF 主估值</dt><dd>{selected && primary ? price(primary.price, primary.kind === "operating" ? primary.publication.currency : currencyOf(selected.ticker)) : "—"}</dd></div>
            <div><dt>同日潜在空间</dt><dd className={upside === null || upside === 0 ? "" : upside > 0 ? "txt-pos" : "txt-neg"}>{upside === null ? "—" : signed(upside)}</dd></div>
          </dl>
        </div>
        <div className={styles.chartHead}>
          <div><h2 id="quadrant-title">自选标的四象限</h2><span>预期 × 空间</span></div>
          <label className={styles.select}><span className={styles.srOnly}>选择标的</span>
            <select value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)} disabled={!companies.length}>
              {!companies.length && <option value="">暂无可选标的</option>}
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name} {company.ticker}</option>)}
            </select>
          </label>
        </div>
        <QuadrantChart points={points} selectedId={selected?.id} onSelect={setSelectedId} />
        <p className={styles.chartNote}>{points.length} / {companies.length} 个标的满足绘图条件 · 横轴采用市场隐含 CAGR 的样本中位数分界，纵轴以 0% 分界。缺少反推数据或同日可比行情的标的不绘制。</p>
        <nav aria-label="工作区快捷入口" className={styles.shortcuts}>
          {shortcuts.map(({ href, label }) => <Link key={href} href={href}>{label}<ArrowRightOutlined aria-hidden="true" /></Link>)}
        </nav>
      </section>
      <aside className={styles.more} aria-labelledby="more-title">
        <div className={styles.moreTitle}><h2 id="more-title">更多资讯</h2></div>
        {news.length > 6 ? <ol start={7} className={styles.moreList}>
          {news.slice(6).map((item, index) => {
            return <li key={item.id}><a href={item.url} target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">{String(index + 7).padStart(2, "0")}</span><div><strong>{item.title}</strong><small><time dateTime={item.publishAt}>{formatDate(item.publishAt, true)}</time></small></div>
            </a></li>;
          })}
        </ol> : <div className={styles.moreEmpty}>{newsState === "loading" ? "正在读取财经快讯…" : "暂无更多资讯"}</div>}
        <div className={styles.newsSources} aria-label="快讯来源">
          {Object.values(MARKET_NEWS_SOURCES).map(({ url, label }) =>
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">{label} <ExportOutlined aria-hidden="true" /></a>)}
        </div>
      </aside>
    </div>
  </div>;
}
