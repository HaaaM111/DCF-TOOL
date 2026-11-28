"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { App, Button, Card, Descriptions, Input, Segmented, Space, Switch, Tabs, Tag } from "antd";
import { useTheme, useWorkspace } from "@/app/providers";
import IndustryMultiplesPanel from "@/components/industry-multiples-panel";
import { financialFieldLabels, type FinancialField } from "@/lib/financial-data-quality";
import { workspaceDefaults } from "@/lib/workspace-preferences";
import type { PrimaryValuation } from "@/lib/primary-valuation";

type Providers = { ifind: boolean; eastmoney: boolean };
type Check = {
  ticker: string;
  checkedAt: string;
  providers: Providers;
  quote: { source: string; date: string; price: number; kind?: "snapshot" | "daily-close" } | null;
  finance: { source: string; periodEnd: string; cashSource: string | null; missingFields: FinancialField[]; cashFlowVerified: boolean } | null;
  valuation: {
    publication: Extract<PrimaryValuation, { kind: "operating" }>["publication"];
    result: { prices: { fcff: number; reoi: number; aoig: number }; reconciliation: { passed: boolean; maximumGap: number };
      priceMatches: boolean; terminalValueShare: number | null; spread: number } | null;
  } | null;
  valuationError: boolean;
};

const providerName = (name: string) => name === "ifind" ? "同花顺 iFinD" : name === "eastmoney" ? "东方财富" : "—";
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

function Setting({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-terminal-line py-3 last:border-b-0">
    <div><div className="font-medium">{title}</div><div className="mt-1 text-xs text-terminal-muted">{description}</div></div>
    <div>{children}</div>
  </div>;
}

function CheckResults({ check }: { check: Check }) {
  const { quote, finance, valuation } = check;
  const calculation = valuation?.result;
  return <Space direction="vertical" size="middle" className="mt-4 w-full">
    <Descriptions title={`${check.ticker} · 数据核对`} size="small" bordered column={1} items={[
      { key: "quote", label: "行情", children: quote ? `${providerName(quote.source)} · ${quote.date} · ${quote.kind === "daily-close" ? "日线收盘价" : "报价快照"} ${quote.price}（交易币种）` : <Tag color="orange">未取得可核验行情</Tag> },
      { key: "finance", label: "财报", children: finance ? `${providerName(finance.source)} · 年报期末 ${finance.periodEnd}${finance.cashSource && finance.cashSource !== finance.source ? ` · 货币资金取自同报告期${providerName(finance.cashSource)}` : ""}` : <Tag color="orange">未取得真实年报</Tag> },
      { key: "fields", label: "缺失或异常字段", children: !finance ? "—" : finance.missingFields.length ? finance.missingFields.map((field) => financialFieldLabels[field]).join("、") : "关键字段已返回" },
      { key: "cashFlow", label: "经营现金流与资本开支", children: finance?.cashFlowVerified ? "已取得同一报告期的现金流量表字段" : "未取得成对的可用数据" },
    ]} />
    <Descriptions title="已发布经营估值复核" size="small" bordered column={1} items={[
      { key: "publication", label: "已发布版本", children: valuation ? `${valuation.publication.valuationDate} · ${valuation.publication.price.toFixed(4)} ${valuation.publication.currency}/股` : check.valuationError ? "底稿暂时无法读取" : "该标的暂无已发布经营估值" },
      ...(calculation ? [
        { key: "results", label: "三种口径（每股）", children: ["fcff", "reoi", "aoig"].map((key) => `${key.toUpperCase()} ${calculation.prices[key as keyof typeof calculation.prices].toFixed(4)}`).join(" · ") },
        { key: "reconciliation", label: "勾稽与历史价格", children: calculation.reconciliation.passed && calculation.priceMatches
          ? `复核通过 · 三口径最大差额 ${calculation.reconciliation.maximumGap.toExponential(2)}` : <Tag color="red">勾稽或历史价格不一致</Tag> },
        { key: "terminal", label: "终值敏感度", children: `WACC 与永续增长率差 ${percent(calculation.spread)} · 终值现值占经营价值 ${calculation.terminalValueShare == null ? "—" : percent(calculation.terminalValueShare)}` },
      ] : []),
    ]} />
  </Space>;
}

export default function SettingsPage() {
  const { mode, setTheme } = useTheme();
  const { preferences, savePreferences } = useWorkspace();
  const { message } = App.useApp();
  const [providers, setProviders] = useState<Providers>();
  const [ticker, setTicker] = useState("603786.SH");
  const [check, setCheck] = useState<Check>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/settings/data-check", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => { if (value?.providers) setProviders(value.providers); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  async function runCheck() {
    setChecking(true);
    setError("");
    setCheck(undefined);
    try {
      const response = await fetch(`/api/settings/data-check?ticker=${encodeURIComponent(ticker.trim())}`,
        { cache: "no-store", signal: AbortSignal.timeout(55000) });
      const value = await response.json();
      if (!response.ok) throw new Error(response.status === 422 ? "请输入有效的股票代码" : "数据诊断暂不可用，请稍后重试。");
      setCheck(value);
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "Error" ? cause.message : "数据诊断暂不可用，请稍后重试。");
    } finally {
      setChecking(false);
    }
  }

  async function logout() {
    try {
      const response = await fetch("/api/auth/signout", { method: "POST", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      window.location.replace("/sign-in");
    } catch { message.error("退出登录失败，请重试"); }
  }

  return <div className="terminal-page max-w-[1000px]">
    <h2 className="text-lg font-semibold">终端设置</h2>
    <p className="mt-1 text-sm text-terminal-muted">管理当前浏览器的显示偏好，核对行情、财报及已发布估值。</p>
    <Tabs className="mt-3" items={[
      { key: "preferences", label: "显示与看板", children: <Card size="small" title="终端偏好（自动保存至当前浏览器）">
        <Setting title="显示主题" description="应用到首页、估值看板和图表。"><Segmented aria-label="显示主题" value={mode} options={[{ label: "浅色", value: "light" }, { label: "深色", value: "dark" }]} onChange={setTheme} /></Setting>
        <Setting title="估值看板密度" description="调整自选列表行高。"><Segmented<"compact" | "comfortable"> aria-label="估值看板密度" value={preferences.boardDensity} options={[{ label: "紧凑", value: "compact" }, { label: "舒展", value: "comfortable" }]} onChange={(boardDensity) => savePreferences({ ...preferences, boardDensity })} /></Setting>
        <Setting title="看板每页标的" description="应用于估值看板的自选列表。"><Segmented aria-label="看板每页标的" value={preferences.boardPageSize} options={[10, 20, 50]} onChange={(boardPageSize) => { if (boardPageSize === 10 || boardPageSize === 20 || boardPageSize === 50) savePreferences({ ...preferences, boardPageSize }); }} /></Setting>
        <Setting title="首页快讯自动刷新" description="开启后前台每分钟同步；关闭后仍可手动换一批。"><Switch aria-label="首页快讯自动刷新" checked={preferences.autoRefreshNews} onChange={(autoRefreshNews) => savePreferences({ ...preferences, autoRefreshNews })} /></Setting>
        <Button className="mt-3" onClick={() => { savePreferences(workspaceDefaults); setTheme("light"); }}>恢复显示默认值</Button>
      </Card> },
      { key: "data", label: "数据与估值诊断", children: <Card size="small" title="核对真实数据与已发布底稿">
        <p className="mb-2 text-xs text-terminal-muted">财报优先查 iFinD，行情优先查东方财富。配置状态不代表数据可用，运行诊断查看实际结果。</p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Tag color={providers?.ifind ? "green" : undefined}>iFinD：{providers ? providers.ifind ? "已配置" : "未配置" : "读取中"}</Tag>
          <Tag color={providers?.eastmoney ? "green" : undefined}>东方财富：{providers ? providers.eastmoney ? "已启用" : "已关闭" : "读取中"}</Tag>
        </div>
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (!checking) void runCheck(); }}>
          <Input aria-label="诊断标的代码" className="max-w-56" value={ticker} maxLength={20} disabled={checking} onChange={(e) => setTicker(e.target.value)} />
          <Button type="primary" htmlType="submit" loading={checking} disabled={!ticker.trim()}>运行诊断</Button>
        </form>
        {error && <p role="alert" className="mt-3 txt-neg">{error}</p>}
        {check && <CheckResults check={check} />}
      </Card> },
      { key: "industries", label: "行业估值资料", children: <IndustryMultiplesPanel /> },
      { key: "valuation", label: "估值口径", children: <Card size="small" title="当前估值规则">
        <Setting title="经营估值" description="显性期以税后经营利润减经营再投资计算 FCFF，以 WACC 折现，再扣净金融负债和少数股东权益。"><Link className="text-terminal-link hover:underline" href="/valuation/new">新增估值</Link></Setting>
        <Setting title="终值与勾稽" description="终值按永续增长计算。发布前核对 FCFF、ReOI 与 AOIG，终值占比可在数据诊断查看。"><Link className="text-terminal-link hover:underline" href="/valuation/board">查看估值看板</Link></Setting>
        <Setting title="历史资料与行情" description="基准日之后才可获得的资料可用于复核底稿，但该结果不展示同日上行空间。"><Link className="text-terminal-link hover:underline" href="/company/603786.SH/models">查看科博达模型</Link></Setting>
      </Card> },
      { key: "account", label: "备份与账户", children: <Card size="small" title="账户与备份">
        <Setting title="导出估值档案" description="下载标的、假设及当前已发布经营底稿。文件不含登录密码和 API Key。"><Button href="/api/export">导出 JSON</Button></Setting>
        <Setting title="智能体配置" description="从智能体页面配置模型与服务连接。"><Link className="text-terminal-link hover:underline" href="/agent">打开智能体</Link></Setting>
        <Setting title="当前会话" description="退出本次登录。"><Button onClick={() => void logout()}>退出登录</Button></Setting>
      </Card> },
    ]} />
  </div>;
}
