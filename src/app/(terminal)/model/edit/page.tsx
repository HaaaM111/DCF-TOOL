"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  Input,
  InputNumber,
  Row,
  Col,
  Button,
  Divider,
  Tag,
  Alert,
  Statistic,
  Typography,
  App,
  Spin,
  Select,
  Tabs,
} from "antd";
import type { DefaultOptionType } from "antd/es/select";
import {
  ThunderboltOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useRouter, useSearchParams } from "next/navigation";
import SupplementalFinancials from "@/components/supplemental-financials";
import AppHeader from "@/components/app-header";
import { ValueDonut } from "@/components/charts";
import type { DcfOutput } from "@/types/dcf";
import { cashFlowFromReport, type AnnualCashFlow } from "@/lib/annual-cash-flow";
import type { CompanyData } from "@/lib/data-source";
import { financialFieldLabels, requiredAutofillFields } from "@/lib/financial-data-quality";

const { Text } = Typography;

interface FormState {
  name: string;
  ticker: string;
  currentPrice: number;
  shares: number;
  cash: number;
  debt: number;
  netCashAdj: number;
  e0: number;
  revenue: number;
  bookValue: number;
  cfo: number;
  capex: number;
  da: number;
  industry: string;
  fxRate: number;
  kd: number;
  taxRate: number;
  baseFcf: number;
  g1: number;
  g2: number;
  g3: number;
  perpetualG: number;
  ke: number;
  payoutRate1: number;
  payoutRate2: number;
  e1: number;
  e2: number;
  e3: number;
  reverseR: number;
  exitPe: number;
  transitionG: number;
  terminalProfitEst: number;
  crpName: string;
  crpBps: number;
}

const defaults: FormState = {
  name: "",
  ticker: "",
  currentPrice: 0,
  shares: 0,
  cash: 0,
  debt: 0,
  netCashAdj: 0,
  e0: 0,
  revenue: 0,
  bookValue: 0,
  cfo: 0,
  capex: 0,
  da: 0,
  industry: "",
  fxRate: 1,
  kd: 0.036,
  taxRate: 0.2,
  baseFcf: 0,
  g1: 0.04,
  g2: 0.025,
  g3: 0.016,
  perpetualG: 0.012,
  ke: 0.12,
  payoutRate1: 0.5,
  payoutRate2: 0.7,
  e1: 0,
  e2: 0,
  e3: 0,
  reverseR: 0.1,
  exitPe: 7,
  transitionG: 0.05,
  terminalProfitEst: 0,
  crpName: "",
  crpBps: 0,
};

function ModelEditContent() {
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get("id");

  const [activeSection, setActiveSection] = useState("basics");
  const [form, setForm] = useState<FormState>(defaults);
  const [loading, setLoading] = useState(false);
  const [calculation, setCalculation] = useState<{ input: FormState; output: DcfOutput } | null>(null);
  const [calculatingInput, setCalculatingInput] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchOptions, setSearchOptions] = useState<DefaultOptionType[]>([]);
  const [searchResults, setSearchResults] = useState<{ ticker: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [fetchingBasics, setFetchingBasics] = useState(false);
  const [cashNeedsReview, setCashNeedsReview] = useState(false);
  const [adoptedScheme, setAdoptedScheme] = useState<string | null>(null);
  const baseFcfEdited = useRef(false);
  const [baseFcfReady, setBaseFcfReady] = useState(false);
  const [cashFlowFields, setCashFlowFields] = useState({ cfo: false, capex: false });
  const [evidence, setEvidence] = useState<CompanyData["evidence"] | null>(null);
  const [annual, setAnnual] = useState<{ ticker: string; median: number | null; source: string | null; reports: AnnualCashFlow[] } | null>(null);
  const [annualLoading, setAnnualLoading] = useState(false);
  const latestRequest = useRef(0);
  const { message } = App.useApp();
  const calc = baseFcfReady && calculation?.input === form ? calculation.output : null;
  const calcLoading = baseFcfReady && calculatingInput === form;

  // 股票搜索防抖
  const searchStocks = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (kw: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!kw || kw.length < 1) {
          setSearchOptions([]);
          return;
        }
        setSearching(true);
        try {
          const res = await fetch(
            `/api/ifind/search?keyword=${encodeURIComponent(kw)}`,
          );
          const json = await res.json();
          const list: { ticker: string; name: string; market?: string }[] =
            json.data ?? [];
          setSearchResults(list);
          setSearchOptions(
            list.map((s) => ({
              value: s.ticker,
              label: (
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-terminal-muted ml-3 font-mono-num">
                    {s.ticker}
                  </span>
                </div>
              ),
            })),
          );
        } catch {
          setSearchOptions([]);
        } finally {
          setSearching(false);
        }
      }, 350);
    };
  }, []);

  // 编辑模式：加载已有标的
  useEffect(() => {
    if (!editId) return;
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/companies/${editId}`);
      const json = await res.json();
      const c = json.company;
      if (c) {
        setCashFlowFields({ cfo: true, capex: true });
        setBaseFcfReady(c.assumption != null);
        setForm({
          ...defaults,
          name: c.name,
          ticker: c.ticker,
          currentPrice: c.currentPrice,
          shares: c.shares,
          cash: c.cash,
          debt: c.debt,
          netCashAdj: c.netCashAdj,
          e0: c.e0,
          revenue: c.revenue ?? 0,
          bookValue: c.bookValue ?? 0,
          cfo: c.cfo,
          capex: c.capex,
          da: c.da,
          industry: c.industry ?? "",
          fxRate: c.fxRate,
          kd: c.kd,
          taxRate: c.taxRate,
          baseFcf: c.assumption?.baseFcf ?? 0,
          g1: c.assumption?.g1 ?? 0.04,
          g2: c.assumption?.g2 ?? 0.025,
          g3: c.assumption?.g3 ?? 0.016,
          perpetualG: c.assumption?.perpetualG ?? 0.012,
          ke: c.assumption?.ke ?? 0.12,
          payoutRate1: c.assumption?.payoutRate1 ?? 0.5,
          payoutRate2: c.assumption?.payoutRate2 ?? 0.7,
          e1: c.assumption?.e1 ?? 0,
          e2: c.assumption?.e2 ?? 0,
          e3: c.assumption?.e3 ?? 0,
          reverseR: c.assumption?.reverseR ?? 0.1,
          exitPe: c.assumption?.exitPe ?? 7,
          transitionG: c.assumption?.transitionG ?? 0.05,
          terminalProfitEst: c.assumption?.terminalProfitEst ?? 0,
          crpName: c.assumption?.crpName ?? "",
          crpBps: c.assumption?.crpBps ?? 0,
        });
      }
      setLoading(false);
    })();
  }, [editId]);

  // URL 预填：?ticker=600104.SH 自动抓取
  useEffect(() => {
    if (editId) return;
    const tickerParam = params?.get("ticker");
    if (!tickerParam) return;
    setForm((f) => ({ ...f, ticker: tickerParam }));
    fetchBasics(tickerParam);
  }, []);

  // 派生：净现金、市值
  const derived = useMemo(() => {
    const netCash = form.cash - form.debt + form.netCashAdj;
    const marketCap = form.currentPrice * form.shares;
    const baseFcfCalc = form.cfo - form.capex;
    const capexDa = form.da > 0 ? form.capex / form.da : 0;
    return { netCash, marketCap, baseFcfCalc, capexDa };
  }, [form]);

  // 一键抓取基础数据（iFinD 代理，无 Token 时返回 mock）
  const fetchBasics = async (tickerOverride?: string) => {
    const ticker = tickerOverride || form.ticker;
    if (!ticker) {
      message.warning("请先选择或输入股票代码");
      return;
    }
    const request = ++latestRequest.current;
    setFetchingBasics(true);
    try {
      const res = await fetch(`/api/ifind/company?ticker=${encodeURIComponent(ticker)}`);
      const json = await res.json();
      if (request !== latestRequest.current) return;
      if (!res.ok || !json.data) throw new Error(json.error ?? "抓取失败");
      if (json.mock) throw new Error("真实行情或财报不可用，请核对数据源后重试");
      const d: CompanyData = json.data;
      const missing = new Set(d.missingFields ?? []);
      const blocked = requiredAutofillFields.filter((field) => missing.has(field));
      if (blocked.length) throw new Error(`年报缺少${blocked.map((field) => financialFieldLabels[field]).join("、")}，未自动填入，请按同一期财报核对。`);
      const reported = d.reportedCashFlow;
      const reportedFcf = reported ? cashFlowFromReport(reported) : null;
      const useReportedFcf = !editId && !baseFcfEdited.current && reportedFcf !== null;
      if (!editId && !baseFcfEdited.current) setBaseFcfReady(useReportedFcf);
      setEvidence(d.evidence);
      setCashFlowFields({ cfo: reported?.cfo != null, capex: reported?.capex != null && reported.capex >= 0 });
      const hasCash = typeof d.cash === "number" && Number.isFinite(d.cash);
      setCashNeedsReview(!hasCash);
      const e1 = +(d.e0 * 1.05).toFixed(2);
      const e2 = +(d.e0 * 1.1).toFixed(2);
      const e3 = +(d.e0 * 1.16).toFixed(2);
      setForm((f) => ({
        ...f,
        currentPrice: d.currentPrice,
        shares: d.shares,
        cash: hasCash ? d.cash ?? f.cash : f.cash,
        debt: d.debt,
        e0: d.e0,
        revenue: d.revenue ?? 0,
        bookValue: missing.has("bookValue") ? f.bookValue : d.bookValue,
        cfo: missing.has("cfo") ? f.cfo : d.cfo,
        capex: missing.has("capex") ? f.capex : d.capex,
        da: missing.has("da") ? f.da : d.da,
        industry: d.industry ?? f.industry ?? "",
        e1: editId ? f.e1 : e1,
        e2: editId ? f.e2 : e2,
        e3: editId ? f.e3 : e3,
        baseFcf: useReportedFcf ? reportedFcf : f.baseFcf,
        name: f.name || d.name || f.ticker,
      }));
      setAdoptedScheme(null);
      const sourceMsg =
        json.source === "eastmoney"
          ? "已从东方财富抓取基础数据（免费源）"
          : "已从 iFinD 抓取基础数据";
      message.success(sourceMsg);
      if (!hasCash) message.warning("货币资金缺失，请按同一期报表手动录入。");
      if (json.incomplete) {
        message.warning(`请核对年报缺失字段：${[...missing].map((field) => financialFieldLabels[field]).join("、") || "现金流量表"}`);
      }
    } catch (err) {
      if (request === latestRequest.current) message.error(err instanceof Error ? err.message : "抓取失败，请检查股票代码或网络");
    } finally {
      if (request === latestRequest.current) setFetchingBasics(false);
    }
  };

  // 选中股票后自动触发抓取
  const handleStockSelect = (ticker: string) => {
    const matched = searchResults.find((s) => s.ticker === ticker);
    setForm((f) => editId ? { ...f, ticker, name: matched?.name || f.name }
      : { ...defaults, ticker, name: matched?.name || ticker });
    setEvidence(null);
    setCashFlowFields({ cfo: false, capex: false });
    setAdoptedScheme(null);
    baseFcfEdited.current = false;
    if (!editId) setBaseFcfReady(false);
    // 直接传入 ticker 避免依赖异步状态更新
    fetchBasics(ticker);
  };

  const annualForTicker = annual?.ticker === form.ticker.toUpperCase() ? annual : null;
  const actualFcf = cashFlowFields.cfo && cashFlowFields.capex ? derived.baseFcfCalc : null;
  const schemes = [
    { id: "actual", label: "本表 CFO − Capex", value: actualFcf, desc: "使用上方填列的经营现金流净额与资本开支。" },
    { id: "median", label: "连续三年年报 FCF 中位数", value: annualForTicker?.median ?? null,
      desc: "使用同一供应商的三个完整年度数据，口径为 CNY 亿元。" },
  ];

  async function loadAnnualCashFlow() {
    setAnnualLoading(true);
    try {
      const res = await fetch(`/api/ifind/annual-cash-flow?ticker=${encodeURIComponent(form.ticker)}`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error();
      setAnnual(await res.json());
    } catch {
      message.warning("年报现金流暂不可用");
    } finally {
      setAnnualLoading(false);
    }
  }

  // 采用某方案：高亮卡片 + 联动填入 baseFcf
  const handleAdoptScheme = (id: string, value: number) => {
    baseFcfEdited.current = true;
    setBaseFcfReady(true);
    setAdoptedScheme(id);
    set("baseFcf", value);
    message.success(`已采用方案，baseFcf = ${value.toFixed(2)} 亿`);
  };

  // 实时计算（防抖）
  useEffect(() => {
    if (!form.ticker || !form.currentPrice || !form.shares || !baseFcfReady) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setCalculatingInput(form);
      try {
        const res = await fetch("/api/dcf/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
          body: JSON.stringify({
            company: {
              name: form.name || form.ticker,
              ticker: form.ticker,
              currentPrice: form.currentPrice,
              shares: form.shares,
              marketCap: derived.marketCap,
              cash: form.cash,
              debt: form.debt,
              netCashAdj: form.netCashAdj,
              netCash: derived.netCash,
              e0: form.e0,
              revenue: form.revenue,
              bookValue: form.bookValue,
              cfo: form.cfo,
              capex: form.capex,
              da: form.da,
              industry: form.industry,
              fxRate: form.fxRate,
              kd: form.kd,
              taxRate: form.taxRate,
            },
            assumptions: {
              baseFcf: form.baseFcf,
              g1: form.g1,
              g2: form.g2,
              g3: form.g3,
              perpetualG: form.perpetualG,
              ke: form.ke,
              payoutRate1: form.payoutRate1,
              payoutRate2: form.payoutRate2,
              e1: form.e1,
              e2: form.e2,
              e3: form.e3,
              reverseR: form.reverseR,
              exitPe: form.exitPe,
              transitionG: form.transitionG,
              terminalProfitEst: form.terminalProfitEst,
              crpName: form.crpName,
              crpBps: form.crpBps,
            },
          }),
        });
        const json = await res.json();
        if (res.ok && !controller.signal.aborted) setCalculation({ input: form, output: json });
      } catch {
        /* 忽略计算错误 */
      } finally {
        if (!controller.signal.aborted) setCalculatingInput(null);
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [form, derived.netCash, derived.marketCap, baseFcfReady]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const selectSection = (section: string) => {
    setActiveSection(section);
    window.scrollTo(0, 0);
  };

  // 保存
  const handleSave = async () => {
    if (cashNeedsReview) {
      selectSection("basics");
      message.error("请核验并填写同一期报表的货币资金");
      return;
    }
    if (!form.name || !form.ticker) {
      selectSection("basics");
      message.error("标的简称与股票代码为必填");
      return;
    }
    if (!baseFcfReady) {
      selectSection("forecast");
      message.error("请录入或选用已核验的起始现金流");
      return;
    }
    setSaving(true);
    const url = editId ? `/api/companies/${editId}` : "/api/companies";
    const method = editId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: {
          name: form.name,
          ticker: form.ticker,
          currentPrice: form.currentPrice,
          shares: form.shares,
          marketCap: derived.marketCap,
          cash: form.cash,
          debt: form.debt,
          netCashAdj: form.netCashAdj,
          netCash: derived.netCash,
          e0: form.e0,
          revenue: form.revenue,
          bookValue: form.bookValue,
          cfo: form.cfo,
          capex: form.capex,
          da: form.da,
          industry: form.industry,
          fxRate: form.fxRate,
          kd: form.kd,
          taxRate: form.taxRate,
        },
        assumptions: {
          baseFcf: form.baseFcf,
          g1: form.g1,
          g2: form.g2,
          g3: form.g3,
          perpetualG: form.perpetualG,
          ke: form.ke,
          payoutRate1: form.payoutRate1,
          payoutRate2: form.payoutRate2,
          e1: form.e1,
          e2: form.e2,
          e3: form.e3,
          reverseR: form.reverseR,
          exitPe: form.exitPe,
          transitionG: form.transitionG,
          terminalProfitEst: form.terminalProfitEst,
          crpName: form.crpName,
          crpBps: form.crpBps,
        },
      }),
    });
    setSaving(false);
    if (res.ok) {
      message.success(editId ? "已更新估值模型" : "已新增估值标的");
      router.push("/valuation/board");
    } else {
      const err = await res.json().catch(() => ({}));
      message.error(err.error ?? "保存失败");
    }
  };

  if (loading)
    return (
      <div className="min-h-screen">
        <AppHeader title={`${editId ? "编辑" : "新增"}上市公司估值模型`} />
        <div className="p-10 text-center">
          <Spin />
        </div>
      </div>
    );

  const f = calc?.forward;
  const r = calc?.reverse;
  const g = calc?.gordon;
  const fairKe = form.ke + form.crpBps / 10000;

  return (
    <div className="min-h-screen">
      <AppHeader
        title={`${editId ? "编辑" : "新增"}上市公司估值模型`}
        subtitle="正向 20 年 DCF 内在价值 + 逆向终局现金流 L 反算 · 实时计算"
      />
      <div className="terminal-page">
        <Tabs
          size="small"
          tabBarGutter={16}
          activeKey={activeSection}
          onChange={selectSection}
          destroyOnHidden={false}
          renderTabBar={(props, TabBar) => (
            <div className="model-tab-toolbar">
              <TabBar {...props} />
              <div className="model-tab-actions flex shrink-0 items-center gap-2">
                <Button size="small" icon={<ReloadOutlined />} onClick={() => {
                  latestRequest.current++;
                  setFetchingBasics(false);
                  setCashNeedsReview(false);
                  setCashFlowFields({ cfo: false, capex: false });
                  setEvidence(null);
                  setAnnual(null);
                  setAdoptedScheme(null);
                  baseFcfEdited.current = false;
                  setBaseFcfReady(false);
                  setForm(defaults);
                }}>重置</Button>
                <Button size="small" type="primary" loading={saving} onClick={handleSave}>保存模型</Button>
              </div>
            </div>
          )}
          items={[
            {
              key: "basics",
              label: "基础财务",
              children: (
                <div className="grid min-w-0 gap-3">
                  <Card title="基础数据抓取" size="small" className="fin-card">
                    <Row gutter={[12, 12]}>
                      <Col xs={24} md={10}>
                        <Text type="secondary">搜索标的（代码或名称）</Text>
                        <Select
                          showSearch
                          value={form.ticker || undefined}
                          placeholder="输入 600104 或 上汽集团…"
                          filterOption={false}
                          onSearch={searchStocks}
                          onChange={(val) => handleStockSelect(val)}
                          onClear={() => set("ticker", "")}
                          options={searchOptions}
                          loading={searching}
                          allowClear
                          style={{ width: "100%" }}
                          notFoundContent={searching ? "搜索中…" : "无匹配标的"}
                        />
                      </Col>
                      <Col xs={24} md={8}>
                        <Text type="secondary">标的简称</Text>
                        <Input
                          placeholder="如 上汽集团"
                          value={form.name}
                          onChange={(e) => set("name", e.target.value)}
                        />
                      </Col>
                      <Col xs={24} md={6}>
                        <Text type="secondary">&nbsp;</Text>
                        <Button
                          type="primary"
                          icon={<ThunderboltOutlined />}
                          onClick={() => fetchBasics()}
                          loading={fetchingBasics}
                          block
                        >
                          一键抓取基础数据
                        </Button>
                      </Col>
                    </Row>
                    {form.currentPrice > 0 && (
                      <Alert
                        className="mt-3"
                        type="success"
                        showIcon
                        title={
                          <span className="font-mono-num">
                            现金 {form.cash}亿 ｜ 负债 {form.debt}亿 ｜ 股本 {form.shares}亿 ｜ E0 {form.e0}亿 ｜
                            FCF {form.baseFcf.toFixed(1)}亿 ｜ Capex/D&amp;A {derived.capexDa.toFixed(2)}
                          </span>
                        }
                      />
                    )}
                  </Card>
                  <SupplementalFinancials companyId={editId ?? undefined}/>
                  <Card size="small" title="基础行情与净现金资产">
                    <Row gutter={[12, 12]}>
                      <Col xs={12} md={8}>
                        <Text type="secondary">标的简称</Text>
                        <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">股票代码</Text>
                        <Input value={form.ticker} onChange={(e) => set("ticker", e.target.value)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">可比公司细分行业</Text>
                        <Input maxLength={50} value={form.industry} onChange={(e) => set("industry", e.target.value)} placeholder="如汽车零部件" />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">当前股价 (元)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.currentPrice} onChange={(v) => set("currentPrice", v ?? 0)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">总股本 (亿股)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.shares} onChange={(v) => set("shares", v ?? 0)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">货币资金 (亿元)</Text>
                        <InputNumber style={{ width: "100%" }} status={cashNeedsReview ? "warning" : undefined}
                          value={cashNeedsReview ? null : form.cash} onChange={(v) => {
                            setCashNeedsReview(v === null);
                            if (v !== null) set("cash", v);
                          }} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">有息负债 (亿元)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.debt} onChange={(v) => set("debt", v ?? 0)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">净现金调整项 (亿元)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.netCashAdj} onChange={(v) => set("netCashAdj", v ?? 0)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">净现金合计 (自动计算)</Text>
                        <Input value={derived.netCash.toFixed(2)} disabled />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">E0 归母净利润 (亿元)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.e0} onChange={(v) => set("e0", v ?? 0)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">港币/人民币汇率</Text>
                        <InputNumber style={{ width: "100%" }} value={form.fxRate} onChange={(v) => set("fxRate", v ?? 1)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">有息债务成本 Kd (%)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.kd * 100} onChange={(v) => set("kd", (v ?? 0) / 100)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">企业所得税率 Tax (%)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.taxRate * 100} onChange={(v) => set("taxRate", (v ?? 0) / 100)} />
                      </Col>
                    </Row>
                  </Card>
                </div>
              ),
            },
            {
              key: "forecast",
              label: "现金流预测",
              children: (
                <div className="grid min-w-0 gap-3">
                  <Card
                    size="small" title="起始自由现金流校验"
                  >
                    <Row gutter={[12, 12]}>
                      <Col xs={12} md={6}>
                        <Text type="secondary">经营现金流净额 CFO (亿元)</Text>
                        <InputNumber
                          style={{ width: "100%" }}
                          value={cashFlowFields.cfo ? form.cfo : null}
                          onChange={(v) => {
                            setCashFlowFields((fields) => ({ ...fields, cfo: v !== null }));
                            setAdoptedScheme(null);
                            set("cfo", v ?? 0);
                          }}
                        />
                      </Col>
                      <Col xs={12} md={6}>
                        <Text type="secondary">资本开支 Capex (亿元)</Text>
                        <InputNumber
                          style={{ width: "100%" }}
                          value={cashFlowFields.capex ? form.capex : null}
                          min={0}
                          onChange={(v) => {
                            setCashFlowFields((fields) => ({ ...fields, capex: v !== null }));
                            setAdoptedScheme(null);
                            set("capex", v ?? 0);
                          }}
                        />
                      </Col>
                      <Col xs={12} md={6}>
                        <Text type="secondary">折旧摊销 D&A (亿元)</Text>
                        <InputNumber
                          style={{ width: "100%" }}
                          value={form.da}
                          onChange={(v) => set("da", v ?? 0)}
                        />
                      </Col>
                      <Col xs={12} md={6}>
                        <Text type="secondary">
                          起始 FCF baseFcf (亿元)
                          <span className="ml-1 text-terminal-link">采用方案后可见</span>
                        </Text>
                        <InputNumber
                          style={{ width: "100%" }}
                          value={baseFcfReady ? form.baseFcf : null}
                          onChange={(v) => {
                            baseFcfEdited.current = true;
                            setBaseFcfReady(v !== null);
                            set("baseFcf", v ?? 0);
                            setAdoptedScheme(null);
                          }}
                        />
                      </Col>
                    </Row>
                    <Alert
                      className="mt-3"
                      type="info"
                      showIcon
                      title={
                        <>
                          <Text strong>
                            采用的 baseFcf ={" "}
                            <span className="font-mono-num text-terminal-link">
                              {baseFcfReady ? `${form.baseFcf.toFixed(2)} 亿` : "待核验"}
                            </span>
                          </Text>
                          <span className="ml-3 text-terminal-muted">
                            （本表 CFO−Capex {actualFcf === null ? "待核验" : `${actualFcf.toFixed(2)} 亿`}）
                          </span>
                          <span className="ml-3">Capex/D&amp;A = {cashFlowFields.capex && form.da > 0 ? derived.capexDa.toFixed(2) : "—"}</span>
                        </>
                      }
                    />
                    {evidence && <p className="mt-2 text-xs text-terminal-muted">
                      抓取财报 {evidence.financial.periodEnd} · {evidence.financial.source} ｜ 抓取行情 {evidence.quote.date} · {evidence.quote.source}
                    </p>}
                    <Divider>起始现金流口径</Divider>
                    <Row gutter={[12, 12]}>
                      {schemes.map((s) => {
                        const value = s.value;
                        const isAdopted = adoptedScheme === s.id;
                        return (
                          <Col xs={24} xl={8} key={s.id}>
                            <div
                              className={`scheme-card flex flex-wrap items-center justify-between gap-2 rounded-md border bg-terminal-canvas p-3 ${
                                isAdopted
                                  ? "border-terminal-accent-hover bg-terminal-hover"
                                  : "border-terminal-line"
                              }`}
                            >
                              <div className="flex-1">
                                <div className="font-medium flex items-center flex-wrap">
                                  {s.label}
                                  {isAdopted && (
                                    <Tag color="green" className="ml-1">
                                      已采用
                                    </Tag>
                                  )}
                                </div>
                                <div className="text-xs text-terminal-muted">{s.desc}</div>
                              </div>
                              <div className="text-right ml-3">
                                <div className="text-lg font-bold font-mono-num text-terminal-link">
                                  {value === null ? "待核验" : `${value.toFixed(2)} 亿`}
                                </div>
                                <Button
                                  size="small"
                                  type={isAdopted ? "primary" : "default"}
                                  ghost={!isAdopted}
                                  disabled={value === null}
                                  onClick={() => { if (value !== null) handleAdoptScheme(s.id, value); }}
                                >
                                  {isAdopted ? "已采用" : "采用"}
                                </Button>
                              </div>
                            </div>
                          </Col>
                        );
                      })}
                    </Row>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button size="small" loading={annualLoading} disabled={!/^\d{6}\.(SH|SZ)$/i.test(form.ticker)}
                        onClick={loadAnnualCashFlow}>查询沪深年报现金流</Button>
                      {annualForTicker && <span className="text-xs text-terminal-muted">
                        {annualForTicker.source ?? "来源不可用"} {annualForTicker.reports.map((row) => {
                          const fcf = cashFlowFromReport(row);
                          return `｜${row.periodEnd}：${fcf === null ? "缺字段" : fcf.toFixed(2)}`;
                        })}
                      </span>}
                    </div>
                  </Card>
                  <Card size="small" title="20 年自由现金流预测">
                    <Row gutter={[12, 12]}>
                      <Col xs={12} md={8}>
                        <Text type="secondary">前 5 年复合增速 (%)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.g1 * 100} onChange={(v) => set("g1", (v ?? 0) / 100)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">6-10 年复合增速 (%)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.g2 * 100} onChange={(v) => set("g2", (v ?? 0) / 100)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">11-20 年复合增速 (%)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.g3 * 100} onChange={(v) => set("g3", (v ?? 0) / 100)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">第 20 年永续增长率 g (%)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.perpetualG * 100} onChange={(v) => set("perpetualG", (v ?? 0) / 100)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">股权要求回报率 Ke (%)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.ke * 100} onChange={(v) => set("ke", (v ?? 0) / 100)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">前 10 年派现率 (%)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.payoutRate1 * 100} onChange={(v) => set("payoutRate1", (v ?? 0) / 100)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">10 年后派现率 (%)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.payoutRate2 * 100} onChange={(v) => set("payoutRate2", (v ?? 0) / 100)} />
                      </Col>
                    </Row>
                  </Card>
                  <Card title="Ke 调整（CRP 风险溢价）" size="small">
                    <Row gutter={[12, 12]}>
                      <Col span={12}>
                        <Text type="secondary">CRP 名称</Text>
                        <Input value={form.crpName} onChange={(e) => set("crpName", e.target.value)} placeholder="如：地缘风险" />
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">CRP 幅度 (bps)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.crpBps} onChange={(v) => set("crpBps", v ?? 0)} />
                      </Col>
                    </Row>
                    <Alert
                      className="mt-3"
                      type="info"
                      showIcon
                      title={`公允 Ke = ${(form.ke * 100).toFixed(2)}% + ${form.crpBps}bps = ${(fairKe * 100).toFixed(2)}%`}
                    />
                  </Card>
                </div>
              ),
            },
            {
              key: "market",
              label: "市场反算",
              children: (
                <div className="grid min-w-0 gap-3">
                  <Card size="small" title="市场隐含终局参数">
                    <Row gutter={[12, 12]}>
                      <Col xs={12} md={8}>
                        <Text type="secondary">E1 当年预期 (亿元)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.e1} onChange={(v) => set("e1", v ?? 0)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">E2 次年预期 (亿元)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.e2} onChange={(v) => set("e2", v ?? 0)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">E3 第三年预期 (亿元)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.e3} onChange={(v) => set("e3", v ?? 0)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">逆向反算折现率 r (%)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.reverseR * 100} onChange={(v) => set("reverseR", (v ?? 0) / 100)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">终局退出乘数 Exit PE</Text>
                        <InputNumber style={{ width: "100%" }} value={form.exitPe} onChange={(v) => set("exitPe", v ?? 0)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">过渡期年化增速 g (%)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.transitionG * 100} onChange={(v) => set("transitionG", (v ?? 0) / 100)} />
                      </Col>
                      <Col xs={12} md={8}>
                        <Text type="secondary">我的终局利润估计 (亿元)</Text>
                        <InputNumber style={{ width: "100%" }} value={form.terminalProfitEst} onChange={(v) => set("terminalProfitEst", v ?? 0)} />
                      </Col>
                    </Row>
                  </Card>
                </div>
              ),
            },
            {
              key: "result",
              label: "估值结果",
              children: (
                <div className="grid min-w-0 gap-3">
                  {calc && (
                    <Card size="small" className="terminal-kpis">
                      <Row gutter={[12, 12]} align="middle">
                        <Col xs={12} lg={6}>
                          <Statistic
                            title="目标价"
                            value={f?.adjustedTargetPrice}
                            precision={2}
                            prefix="¥"
                          />
                          <div className={f && f.adjustedUpside >= 0 ? "font-mono txt-pos" : "font-mono txt-neg"}>
                            上涨空间 {f?.adjustedUpside.toFixed(1)}%
                          </div>
                        </Col>
                        <Col xs={12} lg={6}>
                          <Statistic
                            title="隐含终局现金流 L"
                            value={r?.l}
                            precision={1}
                            suffix="亿"
                          />
                          <div className="text-xs text-terminal-muted">
                            终局现金流 / E3 = {r?.lE3.toFixed(2)}x ｜ 17 年折算 {r?.impliedCagr.toFixed(1)}%
                          </div>
                        </Col>
                        <Col xs={12} lg={6}>
                          <Statistic
                            title="隐含 Ke vs 正向 Ke"
                            value={r?.impliedKe}
                            precision={3}
                            suffix=""
                            styles={{ content: { color: g?.isConsistent ? "var(--pos-green)" : "var(--neg-red)" } }}
                          />
                          <div className="text-xs">
                            正向 Ke {(form.ke * 100).toFixed(1)}% ｜{" "}
                            <span className={g?.isConsistent ? "txt-pos" : "txt-neg"}>
                              {g?.isConsistent ? "自洽" : `不自治(${g?.deviation.toFixed(0)}%)`}
                            </span>
                          </div>
                        </Col>
                        <Col xs={12} lg={6}>
                          <Statistic
                            title="CRP 幅度"
                            value={form.crpBps}
                            suffix="bps"
                          />
                          <div className="text-xs text-terminal-muted">
                            公允 Ke ≈ {(fairKe * 100).toFixed(2)}%
                          </div>
                        </Col>
                      </Row>
                    </Card>
                  )}
                  <Card size="small" title="估值结果 · 价值构成" extra={calcLoading ? <Spin size="small" /> : null}>
                    {calc && f ? (
                      <>
                        <ValueDonut comp={f.composition} />
                        <Divider />
                        <Row gutter={[8, 8]}>
                          <Col span={12}>
                            <Statistic title="显性期现值" value={f.pvExplicitFcf} precision={1} suffix="亿" />
                          </Col>
                          <Col span={12}>
                            <Statistic title="永续价值现值" value={f.pvTerminal} precision={1} suffix="亿" />
                          </Col>
                          <Col span={12}>
                            <Statistic title="留存现金累积" value={f.pvRetained} precision={1} suffix="亿" />
                          </Col>
                          <Col span={12}>
                            <Statistic title="净现金" value={f.composition.netCash} precision={1} suffix="亿" />
                          </Col>
                        </Row>
                        <Divider />
                        <Statistic
                          title="DCF 实体价值 EV"
                          value={f.originalEv}
                          precision={1}
                          suffix="亿"
                        />
                        <div className="text-xs text-terminal-muted mt-1">
                          股权价值 = EV + 净现金 = {f.adjustedEquityValue.toFixed(1)} 亿
                        </div>
                      </>
                    ) : (
                      <div className="text-center text-terminal-muted py-12">
                        填写基础财务与估值假设后查看实时结果
                      </div>
                    )}
                  </Card>
                  {g && !g.isConsistent && (
                    <Alert
                      type="error"
                      showIcon
                      title="Gordon 镜像不自洽"
                      description={g.reason}
                    />
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
export default function ModelEditPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center"><Spin /></div>}>
      <ModelEditContent />
    </Suspense>
  );
}
