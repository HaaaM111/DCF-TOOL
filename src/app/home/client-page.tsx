"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Dropdown, Empty, Select, Spin, Tooltip } from "antd";
import {
  ArrowRightOutlined,
  DownOutlined,
  ExportOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/app-header";
import { ClickPowerUp } from "@/components/evil-buttons/click-powerup";
import { QUADRANT_VIEWS, WatchlistQuadrant } from "@/components/research-charts";
import type { QuadrantCompany, QuadrantView } from "@/components/research-charts";

interface HomeCompany extends QuadrantCompany {
  industry: string;
  marketCap: number;
  lastEvalDate: string | null;
}

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  url: string;
}

const fmtPct = (value: number) =>
  Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
    : "-";

function shortDate(value: string | null) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无记录";
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function newsTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/.exec(value);
  return match ? `${match[2]}-${match[3]} ${match[4]}` : value;
}

export default function HomePage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<HomeCompany[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [quadrantView, setQuadrantView] = useState<QuadrantView>("expectation");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState("");
  const companyRequest = useRef(0);
  const newsRequest = useRef(0);

  const loadCompanies = useCallback(async () => {
    const requestId = ++companyRequest.current;
    setCompaniesLoading(true);
    setCompaniesError("");
    try {
      const res = await fetch("/api/companies", { cache: "no-store" });
      if (!res.ok) throw new Error("标的列表暂不可用");
      const json = (await res.json()) as { companies?: HomeCompany[] };
      if (requestId !== companyRequest.current) return;
      const list = json.companies ?? [];
      setCompanies(list);
      setSelectedId((current) =>
        current && list.some((company) => company.id === current)
          ? current
          : list[0]?.id ?? "",
      );
    } catch (error) {
      if (requestId !== companyRequest.current) return;
      setCompaniesError(error instanceof Error ? error.message : "标的列表暂不可用");
    } finally {
      if (requestId === companyRequest.current) setCompaniesLoading(false);
    }
  }, []);

  const loadNews = useCallback(async () => {
    const requestId = ++newsRequest.current;
    setNewsLoading(true);
    setNewsError("");
    try {
      const res = await fetch("/api/news", { cache: "no-store" });
      if (!res.ok) throw new Error("实时资讯暂时不可用，请稍后重试");
      const json = (await res.json()) as {
        news?: NewsItem[];
        fetchedAt?: string;
      };
      if (requestId !== newsRequest.current) return;
      setNews(json.news ?? []);
    } catch (error) {
      if (requestId !== newsRequest.current) return;
      setNewsError(error instanceof Error ? error.message : "实时资讯暂时不可用");
    } finally {
      if (requestId === newsRequest.current) setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCompanies();
    loadNews();
    return () => {
      companyRequest.current += 1;
      newsRequest.current += 1;
    };
  }, [loadCompanies, loadNews]);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedId) ?? companies[0],
    [companies, selectedId],
  );
  const latestEvaluation = useMemo(
    () =>
      companies.reduce<string | null>((latest, company) => {
        if (!company.lastEvalDate) return latest;
        if (!latest) return company.lastEvalDate;
        return company.lastEvalDate > latest ? company.lastEvalDate : latest;
      }, null),
    [companies],
  );
  const activeQuadrantView =
    QUADRANT_VIEWS.find((item) => item.key === quadrantView) ?? QUADRANT_VIEWS[0];
  const headlineNews = news.slice(0, 6);
  const moreNews = news.slice(6, 13);
  const headlineColumns = [
    [1, 2],
    [0, 3],
    [4, 5],
  ].map((indices) =>
    indices
      .map((index) => ({ item: headlineNews[index], rank: index + 1 }))
      .filter(
        (entry): entry is { item: NewsItem; rank: number } =>
          Boolean(entry.item),
      ),
  );

  return (
    <AppHeader
      actions={
        <div className="home-status">
          <span>{companies.length} 标的</span>
          <span>最近估值 {shortDate(latestEvaluation)}</span>
        </div>
      }
    >
      {companiesError && (
        <Alert
          type="error"
          showIcon
          message={companiesError}
          action={<Button size="small" onClick={loadCompanies}>重试</Button>}
          className="home-alert"
        />
      )}

      <div className="home-main-layout">
        <section className="news-showcase" aria-label="实时资讯">
          <div className="news-showcase-head">
            <h2>实时资讯</h2>
            <Tooltip title="刷新资讯">
              <Button
                type="text"
                aria-label="刷新资讯"
                icon={<ReloadOutlined spin={newsLoading} />}
                onClick={loadNews}
                className="news-showcase-refresh"
              />
            </Tooltip>
          </div>
          {newsError && (
            <Alert type="warning" showIcon message={newsError} className="news-alert" />
          )}
          {newsLoading && !headlineNews.length ? (
            <div className="chart-empty"><Spin /></div>
          ) : headlineNews.length ? (
            <div className="news-masonry">
              {headlineColumns.map((column, columnIndex) => (
                <div className="news-column" key={columnIndex}>
                  {column.map(({ item, rank }) => {
                    const content = (
                      <>
                        <div className="news-card-head">
                          <div className="news-card-person">
                            <span className="news-card-number" aria-hidden="true">
                              {rank}
                            </span>
                            <div>
                              <p>{item.source}</p>
                              <small>{newsTime(item.publishedAt)}</small>
                            </div>
                          </div>
                          {item.url && (
                            <span className="news-card-link" aria-hidden="true">
                              <ExportOutlined />
                            </span>
                          )}
                        </div>
                        <p
                          className={
                            rank === 1
                              ? "news-card-body news-card-body-featured"
                              : "news-card-body"
                          }
                        >
                          {item.title}
                          {rank === 1 && item.summary ? (
                            <>
                              <br />
                              {item.summary.replace(/^【[^】]*】/, "").trim()}
                            </>
                          ) : null}
                        </p>
                      </>
                    );
                    return item.url ? (
                      <a
                        key={item.id}
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="news-card"
                        style={{ order: rank }}
                      >
                        {content}
                      </a>
                    ) : (
                      <article
                        key={item.id}
                        className="news-card"
                        style={{ order: rank }}
                      >
                        {content}
                      </article>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : !newsError ? (
            <div className="chart-empty">暂无资讯</div>
          ) : null}
        </section>

        {moreNews.length > 0 && (
          <section className="home-news home-news-more" aria-label="更多资讯">
            <div className="panel-heading news-heading">
              <a
                className="home-more-news-link"
                href="https://finance.eastmoney.com/"
                target="_blank"
                rel="noreferrer"
                aria-label="前往东方财富财经资讯（新标签页）"
              >
                <h2>更多资讯</h2>
                <ExportOutlined aria-hidden="true" />
              </a>
            </div>
            <div className="news-list">
              {moreNews.map((item, index) => {
                const content = (
                  <>
                    <span className="news-index">{index + 7}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.source} · {newsTime(item.publishedAt)}</small>
                    </div>
                  </>
                );
                return item.url ? (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="news-item"
                  >
                    {content}
                  </a>
                ) : (
                  <div key={item.id} className="news-item">{content}</div>
                );
              })}
            </div>
          </section>
        )}

        <section className="home-market" aria-label="自选标的与四象限">
          {selectedCompany && (
            <section className="focus-strip" aria-label="当前选中标的">
              <div className="focus-company">
                <div className="focus-company-head">
                  <strong>{selectedCompany.name}</strong>
                  <button
                    type="button"
                    className="focus-report-link"
                    onClick={() => router.push(`/report/${selectedCompany.id}`)}
                  >
                    报告 <ArrowRightOutlined />
                  </button>
                </div>
                <small>{selectedCompany.ticker}</small>
              </div>
              <div className="focus-metric">
                <label>最新市价</label>
                <b>¥{selectedCompany.currentPrice.toFixed(2)}</b>
              </div>
              <div className="focus-metric">
                <label>DCF 目标价</label>
                <b>{selectedCompany.targetPrice > 0 ? `¥${selectedCompany.targetPrice.toFixed(2)}` : "尚未估值"}</b>
              </div>
              <div className="focus-metric">
                <label>调整后潜在空间</label>
                <b className={selectedCompany.upside >= 0 ? "txt-pos" : "txt-neg"}>
                  {selectedCompany.targetPrice > 0 ? fmtPct(selectedCompany.upside) : "—"}
                </b>
              </div>
            </section>
          )}

          <section className="home-quadrant">
            <div className="panel-heading quadrant-heading">
              <Dropdown
                trigger={["click"]}
                placement="bottomLeft"
                menu={{
                  items: QUADRANT_VIEWS.map((item) => ({
                    key: item.key,
                    label: item.label,
                  })),
                  selectable: true,
                  selectedKeys: [quadrantView],
                  onClick: ({ key }) => setQuadrantView(key as QuadrantView),
                }}
              >
                <button
                  type="button"
                  className="quadrant-title-trigger"
                  aria-haspopup="menu"
                  aria-label={`切换四象限图，当前为${activeQuadrantView.label}`}
                >
                  <span className="quadrant-title-text">自选标的四象限</span>
                  <span className="quadrant-view-label">{activeQuadrantView.label}</span>
                  <DownOutlined />
                </button>
              </Dropdown>
              {companies.length > 0 && (
                <Select
                  aria-label="选择标的"
                  value={selectedCompany?.id}
                  onChange={setSelectedId}
                  options={companies.map((company) => ({
                    value: company.id,
                    label: `${company.name} ${company.ticker}`,
                  }))}
                  className="company-select"
                  showSearch
                  optionFilterProp="label"
                />
              )}
            </div>
            <div className="quadrant-chart-wrap">
              {companiesLoading ? (
                <div className="chart-empty"><Spin /></div>
              ) : companies.length ? (
                <WatchlistQuadrant
                  companies={companies}
                  selectedId={selectedCompany?.id}
                  onSelect={setSelectedId}
                  view={quadrantView}
                />
              ) : (
                <Empty description="暂无估值标的">
                  <Button type="primary" onClick={() => router.push("/model/edit")}>
                    新增估值标的
                  </Button>
                </Empty>
              )}
            </div>
            <nav className="home-shortcuts" aria-label="研究入口">
              <ClickPowerUp
                className="home-powerup"
                accentColor="var(--brand)"
                onClick={() => router.push("/dashboard")}
              >
                估值看板
              </ClickPowerUp>
              <ClickPowerUp
                className="home-powerup"
                accentColor="var(--brand)"
                onClick={() => router.push("/announcements")}
              >
                公告中心
              </ClickPowerUp>
              <ClickPowerUp
                className="home-powerup"
                accentColor="var(--brand)"
                onClick={() => router.push("/agent")}
              >
                智能体对话
              </ClickPowerUp>
            </nav>
          </section>
        </section>
      </div>
    </AppHeader>
  );
}
