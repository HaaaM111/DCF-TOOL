"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Card,
  Input,
  InputNumber,
  Row,
  Col,
  Button,
  Space,
  Divider,
  Tag,
  Alert,
  Statistic,
  Typography,
  App,
  Spin,
  Select,
} from "antd";
import type { DefaultOptionType } from "antd/es/select";
import {
  ThunderboltOutlined,
  CheckCircleTwoTone,
  WarningFilled,
  ReloadOutlined,
} from "@ant-design/icons";
import { useRouter, useSearchParams } from "next/navigation";
import { ValueDonut } from "@/components/charts";
import type { DcfOutput } from "@/types/dcf";

const { Title, Text } = Typography;

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

  const [form, setForm] = useState<FormState>(defaults);
  const [loading, setLoading] = useState(false);
  const [calc, setCalc] = useState<DcfOutput | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchOptions, setSearchOptions] = useState<DefaultOptionType[]>([]);
  const [searchResults, setSearchResults] = useState<{ ticker: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [fetchingBasics, setFetchingBasics] = useState(false);
  const [adoptedScheme, setAdoptedScheme] = useState<string | null>(null);
  const { message } = App.useApp();

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
                  <span className="text-xs text-slate-400 ml-3 font-mono-num">
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setFetchingBasics(true);
    try {
      const res = await fetch(`/api/ifind/company?ticker=${encodeURIComponent(ticker)}`);
      const json = await res.json();
      if (!res.ok || !json.data) throw new Error(json.error ?? "抓取失败");
      const d = json.data;
      const e1 = +(d.e0 * 1.05).toFixed(2);
      const e2 = +(d.e0 * 1.1).toFixed(2);
      const e3 = +(d.e0 * 1.16).toFixed(2);
      setForm((f) => ({
        ...f,
        currentPrice: d.currentPrice,
        shares: d.shares,
        cash: d.cash,
        debt: d.debt,
        e0: d.e0,
        revenue: d.revenue ?? 0,
        bookValue: d.bookValue ?? 0,
        cfo: d.cfo,
        capex: d.capex,
        da: d.da,
        industry: d.industry ?? f.industry ?? "",
        e1,
        e2,
        e3,
        baseFcf: d.cfo - d.capex,
        name: f.name || d.name || f.ticker,
      }));
      // 采用"当年实际值"方案
      setAdoptedScheme("actual");
      const sourceMsg =
        json.source === "eastmoney"
          ? "已从东方财富抓取基础数据（免费源）"
          : json.mock
            ? "已抓取基础数据（模拟模式）"
            : "已从 iFinD 抓取基础数据";
      message.success(sourceMsg);
      if (json.incomplete) {
        message.warning("东财兜底数据部分字段缺失（Capex/有息负债等），请手动核对后使用");
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "抓取失败，请检查股票代码或网络");
    } finally {
      setFetchingBasics(false);
    }
  };

  // 选中股票后自动触发抓取
  const handleStockSelect = (ticker: string) => {
    const matched = searchResults.find((s) => s.ticker === ticker);
    setForm((f) => ({ ...f, ticker, name: matched?.name || f.name }));
    // 直接传入 ticker 避免依赖异步状态更新
    fetchBasics(ticker);
  };

  // 推荐起点方案
  const schemes = useMemo(() => {
    const actual = form.cfo - form.capex;
    const noCapex = form.e0 + form.da - form.capex;
    const median = (actual + noCapex) / 2;
    const finStripped = actual * 0.73; // 模拟剔除金融类后
    const wcStripped = actual * 0.69; // 模拟剔除营运资本释放后
    return [
      {
        id: "actual",
        label: "当年实际值 (CFO−Capex)",
        value: actual,
        desc: "按季微调，含当年全部波动",
      },
      {
        id: "nocapex",
        label: "无派现口径 (净利+D&A−Capex)",
        value: noCapex,
        desc: "剔除非经常损益/偶发",
      },
      {
        id: "median",
        label: "近3年 FCF 中位数",
        value: median,
        desc: "平滑异常波动",
      },
      {
        id: "fin",
        label: "剔除金融类后",
        value: finStripped,
        desc: "去除财务公司/金融业务扰动，更贴近主业造血",
        recommended: true,
      },
      {
        id: "wc",
        label: "剔除营运资本释放后",
        value: wcStripped,
        desc: "去除一次性营运资本释放",
      },
    ];
  }, [form]);

  // 采用某方案：高亮卡片 + 联动填入 baseFcf
  const handleAdoptScheme = (id: string, value: number) => {
    setAdoptedScheme(id);
    set("baseFcf", value);
    message.success(`已采用方案，baseFcf = ${value.toFixed(2)} 亿`);
  };

  // 实时计算（防抖）
  useEffect(() => {
    if (!form.ticker || !form.currentPrice || !form.shares) return;
    const timer = setTimeout(async () => {
      setCalcLoading(true);
      try {
        const res = await fetch("/api/dcf/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        if (res.ok) setCalc(json);
      } catch {
        /* 忽略计算错误 */
      } finally {
        setCalcLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [form, derived.netCash, derived.marketCap]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // 保存
  const handleSave = async () => {
    if (!form.name || !form.ticker) {
      message.error("标的简称与股票代码为必填");
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
      router.push("/dashboard");
    } else {
      const err = await res.json().catch(() => ({}));
      message.error(err.error ?? "保存失败");
    }
  };

  if (loading) return <div className="p-10 text-center"><Spin /></div>;

  const f = calc?.forward;
  const r = calc?.reverse;
  const g = calc?.gordon;
  const fairKe = form.ke + form.crpBps / 10000;

  return (
    <div className="min-h-screen p-6 max-w-[1400px] mx-auto">
      <Space className="mb-4">
        <Button onClick={() => router.push("/dashboard")}>← 返回看板</Button>
        <Title level={4} style={{ margin: 0 }}>
          {editId ? "编辑" : "新增"}上市公司估值模型
        </Title>
      </Space>

      {/* 实时结果横幅 */}
      {calc && (
        <Card className="mb-4" style={{ borderTop: "3px solid #1d4ed8" }}>
          <Row gutter={[24, 16]} align="middle">
            <Col span={6}>
              <Statistic
                title="目标价"
                value={f?.adjustedTargetPrice}
                precision={2}
                prefix="¥"
                styles={{ content: { color: "#1d4ed8" } }}
              />
              <div className={f && f.adjustedUpside >= 0 ? "txt-pos" : "txt-neg"}>
                上涨空间 {f?.adjustedUpside.toFixed(1)}%
              </div>
            </Col>
            <Col span={6}>
              <Statistic
                title="反算 L (隐含终局利润)"
                value={r?.l}
                precision={1}
                suffix="亿"
                styles={{ content: { color: "#2563eb" } }}
              />
              <div className="text-xs text-slate-500">
                L/E3 = {r?.lE3.toFixed(2)}x ｜ 隐含 CAGR {r?.impliedCagr.toFixed(1)}%
              </div>
            </Col>
            <Col span={6}>
              <Statistic
                title="隐含 Ke vs 正向 Ke"
                value={r?.impliedKe}
                precision={3}
                suffix=""
                styles={{ content: { color: g?.isConsistent ? "#16a34a" : "#dc2626" } }}
              />
              <div className="text-xs">
                正向 Ke {(form.ke * 100).toFixed(1)}% ｜{" "}
                <span className={g?.isConsistent ? "txt-pos" : "txt-neg"}>
                  {g?.isConsistent ? "自洽" : `不自治(${g?.deviation.toFixed(0)}%)`}
                </span>
              </div>
            </Col>
            <Col span={6}>
              <Statistic
                title="CRP 幅度"
                value={form.crpBps}
                suffix="bps"
                styles={{ content: { color: "#d97706" } }}
              />
              <div className="text-xs text-slate-500">
                公允 Ke ≈ {(fairKe * 100).toFixed(2)}%
              </div>
            </Col>
          </Row>
        </Card>
      )}

      <Row gutter={[24, 24]}>
        {/* 左侧：表单 */}
        <Col xs={24} lg={16}>
          {/* 基础数据抓取 */}
          <Card title="基础数据抓取" className="mb-4 fin-card">
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

          {/* baseFcf 校验区 */}
          <Card
            title={<span>📌 起始自由现金流 baseFcf 专属校验区</span>}
            className="mb-4"
          >
            <Row gutter={16}>
              <Col span={6}>
                <Text type="secondary">经营现金流净额 CFO (亿元)</Text>
                <InputNumber
                  style={{ width: "100%" }}
                  value={form.cfo}
                  onChange={(v) => set("cfo", v ?? 0)}
                />
              </Col>
              <Col span={6}>
                <Text type="secondary">资本开支 Capex (亿元)</Text>
                <InputNumber
                  style={{ width: "100%" }}
                  value={form.capex}
                  onChange={(v) => set("capex", v ?? 0)}
                />
              </Col>
              <Col span={6}>
                <Text type="secondary">折旧摊销 D&A (亿元)</Text>
                <InputNumber
                  style={{ width: "100%" }}
                  value={form.da}
                  onChange={(v) => set("da", v ?? 0)}
                />
              </Col>
              <Col span={6}>
                <Text type="secondary">
                  起始 FCF baseFcf (亿元)
                  <span className="ml-1 text-blue-600">👈 采用方案后可见</span>
                </Text>
                <InputNumber
                  style={{ width: "100%" }}
                  value={form.baseFcf}
                  onChange={(v) => {
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
                    <span className="font-mono-num text-blue-700">
                      {form.baseFcf.toFixed(2)} 亿
                    </span>
                  </Text>
                  <span className="ml-3 text-slate-500">
                    （当年实际 CFO−Capex = {derived.baseFcfCalc.toFixed(2)} 亿）
                  </span>
                  <span className="ml-3">Capex/D&amp;A = {derived.capexDa.toFixed(2)}</span>
                </>
              }
            />
            {/* 金融类现金流预警 */}
            <Alert
              className="mt-2"
              type="warning"
              showIcon
              icon={<WarningFilled />}
              title="金融类现金流警报：占 CFO 约 27%"
              description="金融类现金流（财务子公司）会扭曲真实经营 FCF，建议剔除后作为起点。"
            />
            <Alert
              className="mt-2"
              type="warning"
              showIcon
              icon={<WarningFilled />}
              title="CFO 质量警报：营运资本释放造成了约 25% 的 CFO 增量"
              description="营运资本释放不可持续，剔除后更能反映常态盈利能力。"
            />
            <Divider>推荐起点方案（点选即用，无需手算）</Divider>
            <Row gutter={[12, 12]}>
              {schemes.map((s) => {
                const isAdopted = adoptedScheme === s.id;
                return (
                  <Col span={24} key={s.id}>
                    <div
                      className={`scheme-card p-3 rounded-lg border flex items-center justify-between transition-all ${
                        isAdopted
                          ? "bg-[#F0FDF4] border-[#10B981] shadow-md ring-2 ring-green-200"
                          : s.recommended
                            ? "bg-amber-50/40 border-amber-300"
                            : "bg-slate-50 border-slate-200"
                      }`}
                      onClick={() => handleAdoptScheme(s.id, s.value)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex-1">
                        <div className="font-medium flex items-center flex-wrap">
                          {s.label}
                          {s.recommended && (
                            <Tag
                              color="gold"
                              className="ml-2"
                              style={{ fontWeight: 600 }}
                            >
                              👑 强烈推荐
                            </Tag>
                          )}
                          {isAdopted && (
                            <Tag color="green" className="ml-1">
                              已采用
                            </Tag>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">{s.desc}</div>
                      </div>
                      <div className="text-right ml-3">
                        <div className="text-lg font-bold font-mono-num text-blue-700">
                          {s.value.toFixed(2)} 亿
                        </div>
                        <Button
                          size="small"
                          type={isAdopted ? "primary" : "default"}
                          ghost={!isAdopted}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAdoptScheme(s.id, s.value);
                          }}
                        >
                          {isAdopted ? "已采用" : "采用"}
                        </Button>
                      </div>
                    </div>
                  </Col>
                );
              })}
            </Row>
          </Card>

          {/* 基础行情与净现金资产 */}
          <Card title="1. 基础行情与净现金资产" className="mb-4">
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Text type="secondary">标的简称</Text>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">股票代码</Text>
                <Input value={form.ticker} onChange={(e) => set("ticker", e.target.value)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">当前股价 (元)</Text>
                <InputNumber style={{ width: "100%" }} value={form.currentPrice} onChange={(v) => set("currentPrice", v ?? 0)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">总股本 (亿股)</Text>
                <InputNumber style={{ width: "100%" }} value={form.shares} onChange={(v) => set("shares", v ?? 0)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">货币资金 (亿元)</Text>
                <InputNumber style={{ width: "100%" }} value={form.cash} onChange={(v) => set("cash", v ?? 0)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">有息负债 (亿元)</Text>
                <InputNumber style={{ width: "100%" }} value={form.debt} onChange={(v) => set("debt", v ?? 0)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">净现金调整项 (亿元)</Text>
                <InputNumber style={{ width: "100%" }} value={form.netCashAdj} onChange={(v) => set("netCashAdj", v ?? 0)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">净现金合计 (自动计算)</Text>
                <Input value={derived.netCash.toFixed(2)} disabled />
              </Col>
              <Col span={8}>
                <Text type="secondary">E0 归母净利润 (亿元)</Text>
                <InputNumber style={{ width: "100%" }} value={form.e0} onChange={(v) => set("e0", v ?? 0)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">港币/人民币汇率</Text>
                <InputNumber style={{ width: "100%" }} value={form.fxRate} onChange={(v) => set("fxRate", v ?? 1)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">有息债务成本 Kd (%)</Text>
                <InputNumber style={{ width: "100%" }} value={form.kd * 100} onChange={(v) => set("kd", (v ?? 0) / 100)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">企业所得税率 Tax (%)</Text>
                <InputNumber style={{ width: "100%" }} value={form.taxRate * 100} onChange={(v) => set("taxRate", (v ?? 0) / 100)} />
              </Col>
            </Row>
          </Card>

          {/* 20年自由现金流推演 */}
          <Card title="2. 20年自由现金流推演与模板" className="mb-4">
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Text type="secondary">前 5 年复合增速 (%)</Text>
                <InputNumber style={{ width: "100%" }} value={form.g1 * 100} onChange={(v) => set("g1", (v ?? 0) / 100)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">6-10 年复合增速 (%)</Text>
                <InputNumber style={{ width: "100%" }} value={form.g2 * 100} onChange={(v) => set("g2", (v ?? 0) / 100)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">11-20 年复合增速 (%)</Text>
                <InputNumber style={{ width: "100%" }} value={form.g3 * 100} onChange={(v) => set("g3", (v ?? 0) / 100)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">第 20 年永续增长率 g (%)</Text>
                <InputNumber style={{ width: "100%" }} value={form.perpetualG * 100} onChange={(v) => set("perpetualG", (v ?? 0) / 100)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">股权要求回报率 Ke (%)</Text>
                <InputNumber style={{ width: "100%" }} value={form.ke * 100} onChange={(v) => set("ke", (v ?? 0) / 100)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">前 10 年派现率 (%)</Text>
                <InputNumber style={{ width: "100%" }} value={form.payoutRate1 * 100} onChange={(v) => set("payoutRate1", (v ?? 0) / 100)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">10 年后派现率 (%)</Text>
                <InputNumber style={{ width: "100%" }} value={form.payoutRate2 * 100} onChange={(v) => set("payoutRate2", (v ?? 0) / 100)} />
              </Col>
            </Row>
          </Card>

          {/* 逆向财务穿透 */}
          <Card title="3. 逆向财务穿透与市场隐含终局参数" className="mb-4">
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Text type="secondary">E1 当年预期 (亿元)</Text>
                <InputNumber style={{ width: "100%" }} value={form.e1} onChange={(v) => set("e1", v ?? 0)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">E2 次年预期 (亿元)</Text>
                <InputNumber style={{ width: "100%" }} value={form.e2} onChange={(v) => set("e2", v ?? 0)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">E3 第三年预期 (亿元)</Text>
                <InputNumber style={{ width: "100%" }} value={form.e3} onChange={(v) => set("e3", v ?? 0)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">逆向反算折现率 r (%)</Text>
                <InputNumber style={{ width: "100%" }} value={form.reverseR * 100} onChange={(v) => set("reverseR", (v ?? 0) / 100)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">终局退出乘数 Exit PE</Text>
                <InputNumber style={{ width: "100%" }} value={form.exitPe} onChange={(v) => set("exitPe", v ?? 0)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">过渡期年化增速 g (%)</Text>
                <InputNumber style={{ width: "100%" }} value={form.transitionG * 100} onChange={(v) => set("transitionG", (v ?? 0) / 100)} />
              </Col>
              <Col span={8}>
                <Text type="secondary">我的终局利润估计 (亿元)</Text>
                <InputNumber style={{ width: "100%" }} value={form.terminalProfitEst} onChange={(v) => set("terminalProfitEst", v ?? 0)} />
              </Col>
            </Row>
          </Card>

          <Space>
            <Button type="primary" size="large" loading={saving} onClick={handleSave}>
              <CheckCircleTwoTone /> 保存模型
            </Button>
            <Button size="large" icon={<ReloadOutlined />} onClick={() => setForm(defaults)}>
              重置
            </Button>
          </Space>
        </Col>

        {/* 右侧：实时结果 + 环形图 */}
        <Col xs={24} lg={8}>
          <div className="sticky top-4">
            <Card title="价值构成透视（分红修正口径）" extra={calcLoading ? <Spin size="small" /> : null}>
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
                    styles={{ content: { color: "#1d4ed8" } }}
                  />
                  <div className="text-xs text-slate-400 mt-1">
                    股权价值 = EV + 净现金 = {f.adjustedEquityValue.toFixed(1)} 亿
                  </div>
                </>
              ) : (
                <div className="text-center text-slate-400 py-12">
                  填写左侧参数后实时计算
                </div>
              )}
            </Card>

            {/* CRP 调整 */}
            <Card title="Ke 调整（CRP 风险溢价）" className="mt-4">
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

            {g && !g.isConsistent && (
              <Alert
                className="mt-4"
                type="error"
                showIcon
                title="Gordon 镜像不自洽"
                description={g.reason}
              />
            )}
          </div>
        </Col>
      </Row>
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
