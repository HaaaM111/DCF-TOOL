"use client";
import { reviewAssumptions } from "@/lib/assumption-review";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  Collapse,
  Row,
  Col,
  Statistic,
  InputNumber,
  Tag,
  Table,
  Button,
  Input,
  Space,
  Alert,
  Typography,
  Divider,
  Spin,
  Empty,
  App,
} from "antd";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CopyOutlined,
  PlusOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import OperatingValuationPanel from "@/components/operating-valuation-panel";
import CompanySensitivityPanel from "@/components/company-sensitivity-panel";
import ValuationAttributionPanel from "@/components/valuation-attribution-panel";
import { ValueDonut, FcfBars, TrendChart, ConfidenceChart } from "@/components/charts";
import {
  PeerCompareChart,
  ValidationGauge,
} from "@/components/validation-charts";
import { calcDcf } from "@/lib/dcf";
import type { DcfOutput, MonteCarloResult } from "@/types/dcf";
import type { calculatePeerValuation } from "@/lib/peer-valuation-service";
import type { PrimaryValuation } from "@/lib/primary-valuation";
import type { CompanySection } from "./sections";

const { Title, Paragraph, Text } = Typography;

interface CompanyData {
  id: string;
  name: string;
  ticker: string;
  currentPrice: number;
  shares: number;
  marketCap: number;
  cash: number;
  debt: number;
  netCashAdj: number;
  netCash: number;
  e0: number;
  cfo: number;
  capex: number;
  da: number;
  fxRate: number;
  kd: number;
  taxRate: number;
  targetPrice: number | null;
  upside: number | null;
  primaryValuation: PrimaryValuation;
  originalUpside: number;
  impliedKe: number;
  forwardKe: number;
  wacc: number;
  terminalProfitY20: number;
  terminalFcfE3: number;
  impliedL: number;
  impliedLE3: number;
  impliedCagr: number;
  terminalProfitEst: number;
  transitionG: number;
  quadrant: string;
  diagnosis: string;
  assumption?: {
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
  };
  timeline: { id: string; date: string; content: string; tags: string }[];
}

interface ValidationResponse {
  validation: {
    absoluteValue: number | null;
    relativeValue: number | null;
    currentPe: number;
    currentPb: number;
    currentPs: number;
    industryPeMean: number;
    industryPeMedian: number;
    industryPbMean: number;
    industryPsMean: number;
    pePercentile: number;
    pbPercentile: number;
    psPercentile: number;
    premiumDiscount: number;
    diffRate: number | null;
    conclusion: string;
    multiples: Awaited<ReturnType<typeof calculatePeerValuation>>["multiples"];
    peerSelection: Awaited<ReturnType<typeof calculatePeerValuation>>["evidence"];
  };
  peers: { ticker: string; name: string; pe: number; pb: number; ps: number }[];
  hasHistory: boolean;
}

export default function CompanyReport({ id, section }: { id: string; section: CompanySection }) {
  const router = useRouter();
  const overview = section === "overview";
  const sensitivity = section === "sensitivity";
  const comparables = section === "comparables";
  const attribution = section === "attribution";
  const needsSimulation = overview || sensitivity;
  const needsValidation = comparables;

  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [knobPayout, setKnobPayout] = useState<number>();
  const [knobExitPe, setKnobExitPe] = useState<number>();
  const [knobG, setKnobG] = useState<number>();
  const [noteDate, setNoteDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [noteContent, setNoteContent] = useState("");
  const [prices, setPrices] = useState<{ date: string; close: number }[]>([]);
  const [publishedPrices, setPublishedPrices] = useState<{ date: string; targetPrice: number | null }[]>([]);
  const [priceCurrency, setPriceCurrency] = useState<string>();
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [mcLoading, setMcLoading] = useState(false);
  const [jumpEnabled,setJumpEnabled]=useState(false);
  const [jumpLambda,setJumpLambda]=useState(0.1);
  const [jumpMean,setJumpMean]=useState(-0.2);
  const [jumpStd,setJumpStd]=useState(0.1);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [validationLoading, setValidationLoading] = useState(needsValidation);
  const { message } = App.useApp();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/companies/" + encodeURIComponent(id));
      if (!response.ok) throw new Error();
      setCompany((await response.json()).company);
    } catch {
      setCompany(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!overview) return;
    const controller = new AbortController();
    fetch("/api/companies/" + encodeURIComponent(id) + "/prices", { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        setPrices(data.prices ?? []);
        setPublishedPrices(data.valuation ?? []);
        setPriceCurrency(data.currency ?? undefined);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id, overview]);

  useEffect(() => {
    load();
  }, [load]);

  // 蒙特卡洛模拟（假设就绪后触发）
  useEffect(() => {
    if (!needsSimulation || !company?.assumption || company.primaryValuation.kind !== "legacy") return;
    let cancelled = false;
    setMcLoading(true);
    fetch("/api/simulation/monte-carlo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assumptions: company.assumption,
        company: {
          currentPrice: company.currentPrice,
          shares: company.shares,
          netCash: company.netCash,
          e0: company.e0,
        },
        samples: 3000,
        seed:42,
        jump:{enabled:jumpEnabled,lambda:jumpLambda,mean:jumpMean,std:jumpStd},
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.result) setMcResult(d.result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMcLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [company, needsSimulation, jumpEnabled, jumpLambda, jumpMean, jumpStd]);

  // 同行对比允许依赖外部行情；敏感性独立读取底稿。
  useEffect(() => {
    if (!company || !needsValidation) return;
    let cancelled = false;
    setValidationLoading(true);
    fetch("/api/validation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: company.id }),
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.validation) setValidation(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setValidationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [company, needsValidation]);

  // 用客户端引擎重算（用于三旋钮与敏感性交互）
  const output: DcfOutput | null = useMemo(() => {
    if (!company?.assumption) return null;
    try {
      const a = company.assumption;
      return calcDcf(a, {
        currentPrice: company.currentPrice,
        shares: company.shares,
        netCash: company.netCash,
        e0: company.e0,
      });
    } catch (e) {
      console.error("DCF 计算失败:", e);
      return null;
    }
  }, [company]);

  // 三旋钮：调整派现率/ExitPE/永续g 后重算隐含 Ke
  const knobOutput = useMemo(() => {
    if (!sensitivity || company?.primaryValuation.kind !== "legacy" || !company.assumption) return null;
    const saved = company.assumption;
    const a = { ...saved, payoutRate2: knobPayout ?? saved.payoutRate2, exitPe: knobExitPe ?? saved.exitPe, perpetualG: knobG ?? saved.perpetualG };
    try { return calcDcf(a, {
      currentPrice: company.currentPrice,
      shares: company.shares,
      netCash: company.netCash,
      e0: company.e0,
    }); } catch { return null; }
  }, [company, sensitivity, knobPayout, knobExitPe, knobG]);

  // 公司画像（规则引擎）—— 必须在 early return 之前调用
  const profile = useMemo(() => {
    const f = output?.forward;
    const r = output?.reverse;
    const g = output?.gordon;
    if (!company || !f || !r || !g) return null;
    const c = company;
    const positioning =
      c.netCash > c.marketCap
        ? "现金覆盖型：市值低于净现金，市场给生意的定价为负——本质是现金底 + 困境反转期权，跟踪重心是止血而非增长。"
        : r.lE3 < 0
          ? "业务负定价：市场隐含终局利润为负，认为当前业务长期无法盈利。"
          : r.lE3 > 40
            ? "高增长透支型：市场给了极高的终局利润倍数，预期已相当饱满。"
            : "稳态估值型：市场隐含终局利润处于合理区间。";
    const cashShare = f.adjustedEquityValue > 0 ? `，占模型股权价值 ${(c.netCash / f.adjustedEquityValue * 100).toFixed(0)}%` : "";
    const capexShare = c.da > 0 && c.capex > 0 ? (c.capex / c.da).toFixed(2) : "待核验";
    const body = `市值 ${c.marketCap.toFixed(0)} 亿，净现金 ${c.netCash.toFixed(0)} 亿${cashShare}。本期 Capex/D&A ${capexShare}，模型前五年现金流增速假设 ${((c.assumption?.g1 ?? 0) * 100).toFixed(1)}%。`;
    const marketBet = `隐含终局利润 ${r.l.toFixed(0)} 亿，L/E3 = ${r.lE3.toFixed(1)}x（${c.diagnosis}），隐含 20 年 CAGR ${r.impliedCagr.toFixed(1)}%。`;
    const modelSays = `股东回报口径 +${f.adjustedUpside.toFixed(1)}%（原版 +${f.originalUpside.toFixed(1)}%，裂口 ${(f.adjustedUpside - f.originalUpside).toFixed(0)}pct = 留存再投资回报 vs 无风险的分歧）；价值构成以「${f.composition.netCash > f.composition.explicit ? "净现金" : "显性期"}」为主。`;
    const check = g.isConsistent
      ? `自洽：隐含 Ke ${(g.impliedKe * 100).toFixed(1)}% ≈ 正向 Ke ${(g.forwardKe * 100).toFixed(1)}%。`
      : `不自洽 ${g.deviation.toFixed(0)}%：隐含 Ke ${(g.impliedKe * 100).toFixed(1)}% vs 正向 Ke ${(g.forwardKe * 100).toFixed(1)}%。`;
    return { positioning, body, marketBet, modelSays, check };
  }, [company, output]);

  if (loading)
    return (
      <div aria-busy="true">
        <div className="p-10 text-center">
          <Spin />
        </div>
      </div>
    );
  if (!company)
    return (
      <div>
        <div className="p-10 text-center">
          <Empty description="暂时无法读取标的，请重试" />
          <Button className="mt-4" onClick={() => router.push("/valuation/board")}>
            返回看板
          </Button>
        </div>
      </div>
    );

  const c = company;
  const primary = c.primaryValuation;
  const publication = primary.kind === "operating" ? primary.publication : undefined;
  const hasPublishedPrices = publishedPrices.some((item) => item.targetPrice !== null);
  const f = output?.forward;
  const r = output?.reverse;
  const g = output?.gordon;
  const sens = primary.kind === "legacy" ? output?.sensitivity : undefined;
  const payout = knobPayout ?? c.assumption?.payoutRate2 ?? 0;
  const exitPe = knobExitPe ?? c.assumption?.exitPe ?? 0;
  const perpetualG = knobG ?? c.assumption?.perpetualG ?? 0;
  const formatRate = (v: number) => `${Number((v * 100).toFixed(4))}%`;

  const sensitivityColumns = (label: string) => [
    { title: label, dataIndex: "param", width: 100 },
    {
      title: "隐含 L (亿)",
      dataIndex: "l",
      width: 120,
      render: (v: number | null) => v === null ? "—" : <span className="txt-mid">{v.toFixed(2)}</span>,
    },
    {
      title: "L/E3",
      dataIndex: "lE3",
      width: 100,
      render: (v: number | null) => v === null ? "—" : `${v.toFixed(2)}x`,
    },
  ];

  const addNote = async () => {
    if (!noteContent.trim()) {
      message.warning("请填写记录内容");
      return;
    }
    const res = await fetch(`/api/companies/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: noteDate, content: noteContent }),
    });
    if (res.ok) {
      message.success("已添加记录");
      setNoteContent("");
      load();
    } else {
      message.error("添加失败");
    }
  };

  const deleteNote = async (noteId: string) => {
    // 笔记删除接口（复用 companies/[id] 下的 noteId 路由）
    const res = await fetch(`/api/companies/${id}/notes/${noteId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      message.success("已删除");
      load();
    } else {
      message.error("删除失败");
    }
  };

  const copyPrompt = (text: string) => {
    navigator.clipboard.writeText(text).then(() => message.success("已复制提示词"));
  };

  return (
    <div className="min-w-0">
      <div className="min-w-0">
      {overview && <>
      {/* 核心指标卡 */}
      <div className="market-strip research-strip mb-3 grid grid-cols-2 overflow-hidden rounded-md border border-terminal-line bg-terminal-surface sm:grid-cols-3 xl:grid-cols-5">

          <div className="research-metric min-w-0">
            <Statistic title="当前股价 / 市值" value={c.currentPrice} precision={2} prefix="¥" />
            <div className="text-xs text-terminal-muted">{c.marketCap.toFixed(1)} 亿 ｜ 总股本 {c.shares} 亿股</div>
          </div>

          <div className="research-metric min-w-0">
            <Statistic
              title={publication ? "已发布经营估值" : primary.kind === "legacy" ? "简化估值参考" : "主估值待核验"}
              value={c.targetPrice ?? "—"}
              precision={2}
              suffix={c.targetPrice === null ? undefined : `${publication?.currency ?? "CNY"}/股`}
            />
            {publication && <div className="text-xs text-terminal-muted">
              估值基准日 {publication.valuationDate}
            </div>}
          </div>

          <div className="research-metric min-w-0">
            <Statistic
              title="同日隐含上行空间"
              value={c.upside ?? "—"}
              precision={1}
              suffix={c.upside === null ? undefined : "%"}
              prefix={c.upside !== null && c.upside > 0 ? "+" : ""}
              styles={{ content: { color: c.upside === null || c.upside === 0 ? undefined : c.upside > 0 ? "var(--pos-green)" : "var(--neg-red)" } }}
            />
            <div className="text-xs text-terminal-muted">{c.upside !== null ? publication?.valuationDate : "需同日收盘价及当时可得资料"}</div>
          </div>

          <div className="research-metric min-w-0">
            <Statistic title={publication ? "经营估值 WACC" : "WACC 资本结构诊断"} value={publication ? publication.wacc * 100 : c.assumption ? (reviewAssumptions(c.assumption,c).wacc ?? c.assumption.ke)*100 : "—"} precision={2} suffix="%" />
            {!publication && <div className="text-xs text-terminal-muted">Ke {((c.forwardKe ?? 0) * 100).toFixed(1)}% ｜ Kd 税后 {(c.kd * (1 - c.taxRate) * 100).toFixed(2)}%</div>}
          </div>

          <div className="research-metric min-w-0">
            <Statistic title={publication ? "终值 / 经营价值" : "派现终值 / 股权价值"}
              value={publication ? publication.terminalValueShare === null ? "—" : publication.terminalValueShare * 100 : f?.composition.total ? f.pvTerminal / f.composition.total * 100 : "—"}
              precision={1} suffix="%" />
          </div>
      </div>

      {primary.kind !== "operating" && <Alert className="mb-4" type="warning" showIcon title={primary.reason} />}

      <div className={g ? "grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : undefined}>
      {/* 股价 vs DCF 估值趋势图 */}
        <Card
          size="small"
          title={hasPublishedPrices ? "收盘价与主估值" : "股价走势"}
          extra={<span className="text-xs text-terminal-muted">{hasPublishedPrices ? "目标价从发布日期起显示" : "历史收盘价"}</span>}
          className="mb-4"
        >
          {prices.length > 0 ? <TrendChart
            prices={prices}
            valuation={publishedPrices}
            currency={priceCurrency}
          /> : <Empty description="暂无历史行情" />}
        </Card>

      {/* Gordon 自洽校验 */}
      {g && (
        <Card
          className="mb-4"
          size="small"
          title="Gordon 镜像自洽校验"
          extra={
            g.isApplicable === false ? <Tag color="default">不适用</Tag> : g.isConsistent ? (
              <Tag icon={<CheckCircleFilled />} color="success">自洽</Tag>
            ) : (
              <Tag icon={<CloseCircleFilled />} color="error">不自洽 ({g.deviation.toFixed(0)}%)</Tag>
            )
          }
        >
          <Paragraph>
            <Text strong>隐含 Ke {g.isApplicable === false ? "不适用" : `${(g.impliedKe * 100).toFixed(1)}%`}</Text> vs{" "}
            <Text strong>正向 Ke {(g.forwardKe * 100).toFixed(1)}%</Text> ｜ 偏差{" "}
            <span className={g.isConsistent ? "txt-pos" : "txt-neg"}>{g.deviation.toFixed(1)}%</span>
          </Paragraph>
          <Alert
            type={g.isConsistent ? "success" : "error"}
            showIcon
            title={g.reason}
          />
        </Card>
      )}

      </div>
      </>}

      {sensitivity && <CompanySensitivityPanel key={c.id} companyId={c.id} />}

      {sensitivity && primary.kind === "legacy" && c.assumption && <>
      {/* 三旋钮解算 */}
      <Card title="简化模型情景试算" className="mb-4">
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card size="small" className="scenario-knob scenario-knob-payout">
              <div className="text-sm">终局派现率：{formatRate(payout)}</div>
              <Button size="small" onClick={() => setKnobPayout(payout >= 0.7 ? 0.5 : 0.75)}>
                切换派现率
              </Button>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" className="scenario-knob scenario-knob-exit">
              <div className="text-sm">Exit PE：{exitPe}x</div>
              <Button size="small" onClick={() => setKnobExitPe(exitPe >= 7 ? 4.7 : 7)}>
                切换 Exit PE
              </Button>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" className="scenario-knob scenario-knob-growth">
              <div className="text-sm">永续 g：{formatRate(perpetualG)}</div>
              <Button size="small" onClick={() => setKnobG(perpetualG > 0 ? 0 : 0.012)}>
                切换永续 g
              </Button>
            </Card>
          </Col>
        </Row>
        {knobOutput && (
          <Alert
            type="warning"
            showIcon
            title={`Exit PE 镜像 Ke：${knobOutput.gordon.isApplicable ? formatRate(knobOutput.gordon.impliedKe) : "不适用"} · Gordon 每股估值 ${knobOutput.forward.adjustedTargetPrice.toFixed(2)}`}
            description="Exit PE 只用于镜像校验，不进入正向 Gordon 终值公式；试算不会保存假设。"
          />
        )}
        {!knobOutput && <Alert type="info" showIcon title="当前试算参数无有效估值，请检查永续增长率和折现率。" />}
      </Card>

      </>}

      {section === "models" && <>
      <OperatingValuationPanel key={c.id} ticker={c.ticker} companyId={c.id} publication={publication} onPublished={(next) => {
        const upside = next.comparableQuote === null || next.retrospective ? null : (next.price / next.comparableQuote - 1) * 100;
        setCompany((previous) => previous ? { ...previous, targetPrice: next.price, upside,
          primaryValuation: { kind: "operating", publication: next, price: next.price, upside } } : previous);
      }} />

      {f && <Collapse items={[{ key: "legacy", label: "存量简化模型 · 口径与价值拆解", children: <>
      <Alert
        className="mb-3"
        type="info"
        showIcon
        title="存量简化模型口径"
        description={
          <ul className="mb-0">
            <li>正向 Y20（{f?.fcfY20.toFixed(1)} 亿）= 基于 baseFcf 按 20 年增长率推演出的第 20 年自由现金流（FCF 口径）。</li>
            <li>终局利润估计（{(c.terminalProfitEst ?? 0).toFixed(0)} 亿）= 用户对第 20 年净利润的主观判断，用于逆向反算。</li>
            <li>股东回报口径 = 派现折现 + 留存现金（按 2% 复利累积至第 20 年再折现）+ 净现金。</li>
          </ul>
        }
      />


      {/* 一、正向 DCF 价值拆解 */}
      <Card
        title="一、简化股东回报模型 · 结构拆解"
        extra={<Tag color="blue">Ke {(c.forwardKe * 100).toFixed(2)}%</Tag>}
        className="mb-4"
      >
        <Row gutter={[16, 16]} className="mb-4">
          <Col xs={12} md={6}>
            <Statistic title="显性期现值合计 (0-20年)" value={f?.pvExplicitFcf} precision={1} suffix="亿" />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="第20年永续价值现值 (PV of TV)" value={f?.pvTerminal} precision={1} suffix="亿" />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="净现金 (现金-负债+调整)" value={f?.composition.netCash} precision={1} suffix="亿" styles={{ content: { color: "#16a34a" } }} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="DCF 实体价值 EV" value={f?.originalEv} precision={1} suffix="亿" styles={{ content: { color: "#1d4ed8" } }} />
          </Col>
        </Row>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section className="min-w-0">
            <Title level={5}>价值构成拆解（分红修正口径）</Title>
            {f && <ValueDonut comp={f.composition} />}
          </section>
          <section className="min-w-0">
            <Title level={5}>20 年自由现金流与折现现值（亿元）</Title>
            {f && <FcfBars rows={f.rows} />}
          </section>
        </div>
      </Card>
      </> }]} />}
      </>}

      {sensitivity && <>
      {/* 二、逆向 DCF */}
      {sens && (
        <Card
          title="二、逆向 DCF 财务穿透 · 市场隐含终局分析"
          extra={<Tag>参数 r={formatRate(c.assumption?.reverseR ?? 0)} / 退出PE={c.assumption?.exitPe}x</Tag>}
          className="mb-4"
        >
          <Table
            size="small"
            pagination={false}
            columns={[
              { title: "折现率 r", dataIndex: "param", align: "right", render: formatRate },
              { title: "隐含终局现金流 L", dataIndex: "l", align: "right", render: (v: number | null) => v === null ? "—" : `${v.toFixed(2)} 亿` },
              { title: "L/E3 倍数", dataIndex: "lE3", align: "right", render: (v: number | null) => v === null ? "—" : `${v.toFixed(2)}x` },
              { title: "L/E0 倍数", dataIndex: "l", align: "right", responsive: ["md"], render: (v: number | null) => v !== null && c.e0 > 0 ? `${(v / c.e0).toFixed(2)}x` : "—" },
              {
                title: "叙事分级诊断",
                responsive: ["md"],
                render: () => <Tag color={c.diagnosis.includes("现金") ? "green" : "blue"}>{c.diagnosis}</Tag>,
              },
            ]}
            dataSource={sens.r.map((cell) => ({ ...cell, key: cell.param }))}
          />

          <Divider>逆向情景切片</Divider>
          <p className="mb-3 text-xs text-terminal-muted">Gordon 切片反推终局现金流；退出 PE 切片反推终局净利润。两种口径不可直接混用。</p>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card size="small" title="① L_conservative 对折现率 r">
                <Table size="small" pagination={false} columns={sensitivityColumns("折现率")} dataSource={sens.r.map((x) => ({ ...x, param: formatRate(x.param), key: x.param }))} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="② L_multiple 对退出 PE">
                <Table size="small" pagination={false} columns={sensitivityColumns("退出PE")} dataSource={sens.exitPe.map((x) => ({ ...x, param: `${x.param}x`, key: x.param }))} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="③ L_gordon 对永续 g">
                <Table size="small" pagination={false} columns={sensitivityColumns("永续g")} dataSource={sens.g.map((x) => ({ ...x, param: formatRate(x.param), key: x.param }))} />
              </Card>
            </Col>
          </Row>
        </Card>
      )}

      {primary.kind === "legacy" && <Card
        title="四、简化模型蒙特卡洛 · 每股估值分布"
        extra={
          <Space>
            <Tag color="green">P5 ¥{mcResult?.p5?.toFixed(2) ?? "-"}</Tag>
            <Tag color="blue">中位数 ¥{mcResult?.median?.toFixed(2) ?? "-"}</Tag>
            <Tag color="red">P95 ¥{mcResult?.p95?.toFixed(2) ?? "-"}</Tag>
          </Space>
        }
        className="mb-4"
      >
        <div className="simulation-controls"><label><input type="checkbox" checked={jumpEnabled} onChange={e=>setJumpEnabled(e.target.checked)}/> 启用跳跃压力情景</label><label>λ/年 <InputNumber min={0} max={5} step={0.05} value={jumpLambda} onChange={v=>setJumpLambda(v??0.1)}/></label><label>跳跃对数均值 <InputNumber min={-2} max={1} step={0.05} value={jumpMean} onChange={v=>setJumpMean(v??-0.2)}/></label><label>幅度标准差 <InputNumber min={0} max={1} step={0.05} value={jumpStd} onChange={v=>setJumpStd(v??0.1)}/></label></div>
        <Text type="secondary">逐年现金流泊松跳跃；未做漂移补偿，属于未校准压力测试，不能解释为真实灾难概率。</Text>
        {mcResult?.base && <div className="mt-3">基础 P5/P95：¥{mcResult.base.p5.toFixed(2)} / ¥{mcResult.base.p95.toFixed(2)}{mcResult.jump && <> ｜含跳跃：¥{mcResult.jump.p5.toFixed(2)} / ¥{mcResult.jump.p95.toFixed(2)}</>} ｜拒绝样本 {mcResult.rejected??0}</div>}
        {mcLoading ? (
          <div className="text-center py-8"><Spin description="蒙特卡洛模拟中（3000 次采样）..." /></div>
        ) : mcResult ? (
          <div>
            <ConfidenceChart mc={mcResult} currentPrice={c.currentPrice} />
            <Row gutter={[16, 8]} className="mt-4">
              <Col span={6}><Statistic title="P5（保守）" value={mcResult.p5} precision={2} prefix="¥" styles={{ content: { color: "#EF4444" } }} /></Col>
              <Col span={6}><Statistic title="P25" value={mcResult.p25} precision={2} prefix="¥" /></Col>
              <Col span={6}><Statistic title="中位数" value={mcResult.median} precision={2} prefix="¥" styles={{ content: { color: "#4F46E5" } }} /></Col>
              <Col span={6}><Statistic title="P95（乐观）" value={mcResult.p95} precision={2} prefix="¥" styles={{ content: { color: "#10B981" } }} /></Col>
            </Row>
            <Alert
              className="mt-3"
              type={mcResult.pricePercentile > 75 ? "warning" : mcResult.pricePercentile < 25 ? "success" : "info"}
              showIcon
              title={`当前市价处于分布的第 ${mcResult.pricePercentile.toFixed(0)} 分位`}
              description={
                mcResult.pricePercentile > 75
                  ? "市价接近分布上沿，市场定价偏乐观，安全边际不足。"
                  : mcResult.pricePercentile < 25
                    ? "市价处于分布下沿，市场定价偏悲观，存在安全边际。"
                    : "市价处于分布中部，定价相对中性。"
              }
            />
          </div>
        ) : (
          <Empty description="置信区间计算失败" />
        )}
      </Card>}

      </>}

      {needsValidation && <Card
        title="绝对与相对估值交叉验证"
        extra={comparables && (
          <Tag color={validation?.validation?.conclusion === "一致" ? "green" : "orange"}>
            {validation?.validation?.conclusion ?? (validationLoading ? "计算中" : "待验证")}
          </Tag>
        )}
        className="mb-4"
      >
        {validationLoading ? (
          <div className="text-center py-8">
            <Spin description="正在计算确定性交叉验证…" />
          </div>
        ) : validation?.validation ? (
          <>
            {comparables && <>
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Card size="small" title="PE/PB/PS 横向对比（均值辅助，中位数为主）">
                  <PeerCompareChart methods={validation.validation.multiples.methods} />
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card size="small" title="绝对 vs 相对 估值差异">
                  <ValidationGauge
                    absoluteValue={validation.validation.absoluteValue}
                    relativeValue={validation.validation.relativeValue}
                    diffRate={validation.validation.diffRate}
                    conclusion={validation.validation.conclusion}
                  />
                </Card>
              </Col>
            </Row>

            <Row gutter={[16, 16]} className="mt-4">
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="当前 PE / 历史分位"
                    value={validation.validation.multiples.methods[0]?.current ?? "—"}
                    precision={1}
                    suffix={validation.hasHistory && validation.validation.multiples.methods[0]?.current != null ? `(${validation.validation.pePercentile.toFixed(0)}%)` : undefined}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="同行 PE 中位数"
                    value={(validation.validation.multiples.methods[0]?.count ?? 0) >= 3 ? validation.validation.multiples.methods[0].median ?? "—" : "—"}
                    precision={1}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="相对行业溢价率"
                    value={(validation.validation.multiples.methods[0]?.count ?? 0) >= 3 && validation.validation.multiples.methods[0]?.current != null ? validation.validation.premiumDiscount : "—"}
                    precision={1}
                    suffix="%"
                    styles={{
                      content: {
                        color: validation.validation.premiumDiscount > 0 ? "#EA580C" : "#16A34A",
                      },
                    }}
                  />
                </Card>
              </Col>
            </Row>

            {validation.validation.multiples && <Table size="small" pagination={false} rowKey="name" className="mt-4 fin-table" dataSource={validation.validation.multiples.methods} columns={[
              {title:"倍数",dataIndex:"name"},{title:"有效同行",dataIndex:"count",align:"right"},{title:"均值",dataIndex:"mean",align:"right",render:(v:number|null)=>v?.toFixed(2)??"—"},{title:"中位数（主口径）",dataIndex:"median",align:"right",render:(v:number|null)=>v?.toFixed(2)??"—"},{title:"股权价值/亿元",dataIndex:"equityValue",align:"right",render:(v:number|null)=>v?.toFixed(1)??"数据不足"}
            ]}/>}
            <Paragraph type="secondary" className="mt-4">
              {validation.validation.peerSelection.industry || "待配置细分行业"} · 年报 {validation.validation.peerSelection.period ?? "待核验"}
              {" "}· 收盘日 {validation.validation.peerSelection.quoteDate ?? "待核验"} · CNY
              {validation.validation.peerSelection.sources && ` · 标的财报 ${validation.validation.peerSelection.sources.financial} / 行情 ${validation.validation.peerSelection.sources.quote}`}
            </Paragraph>
            <Table size="small" pagination={false} rowKey="ticker" scroll={{ x: 730 }} dataSource={validation.validation.peerSelection.peerEvidence.map((peer) => ({
              ...peer, ratios: validation.peers.find(({ ticker }) => ticker === peer.ticker),
            }))} columns={[
              { title: "同行", render: (_, peer) => `${peer.name}（${peer.ticker}）` },
              { title: "入选依据", dataIndex: "reason" },
              ...(["pe", "pb", "ps"] as const).map((key) => ({
                title: { pe: "P/E", pb: "P/B", ps: "P/S" }[key],
                key, align: "right" as const,
                render: (_: unknown, peer: { ratios?: ValidationResponse["peers"][number] }) =>
                  (peer.ratios?.[key] ?? 0) > 0 ? peer.ratios![key].toFixed(2) : "—",
              })),
              { title: "数据核验", render: (_, peer) => peer.excluded ?? `财报 ${peer.financialSource} / 行情 ${peer.quoteSource}` },
            ]} />
            </>}
          </>
        ) : (
          <Empty description="估值验证失败，请稍后重试" />
        )}
      </Card>}

      {section === "notes" && <>
      {/* 公司画像 */}
      {profile && (
        <Card
          title="公司画像（规则引擎自动生成）"
          extra={<Tag color="gold">v6.5 · 保存即刷新，脱机可用</Tag>}
          className="mb-4"
        >
          <div className="space-y-2">
            <p><Text strong>定位：</Text>{profile.positioning}</p>
            <p><Text strong>躯体：</Text>{profile.body}</p>
            <p><Text strong>市场在赌：</Text>{profile.marketBet}</p>
            <p><Text strong>模型在说：</Text>{profile.modelSays}</p>
            <p><Text strong>校验灯：</Text><span className={g?.isConsistent ? "txt-pos" : "txt-neg"}>{profile.check}</span></p>
          </div>
          <Button
            type="primary"
            icon={<CopyOutlined />}
            className="mt-3"
            onClick={() => copyPrompt(`你是一位资深卖方分析师。请基于以下公司画像，输出一份 300 字的大白话深度画像：\n定位：${profile.positioning}\n躯体：${profile.body}\n市场在赌：${profile.marketBet}\n模型在说：${profile.modelSays}`)}
          >
            复制 Kimi 深度画像提示词
          </Button>
        </Card>
      )}

      {/* 复盘记录 */}
      <Card
        title="复盘记录"
        extra={`共 ${c.timeline?.length ?? 0} 条 · 可追加/删除`}
        className="mb-4"
      >
        <div className="mb-4 flex gap-2 flex-wrap">
          <Input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} style={{ width: 160 }} />
          <Input.TextArea
            rows={2}
            placeholder="例：本次把终局利润从X上调到Y，原因是…；最大的担忧是…；下次验证点：…"
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            style={{ flex: "1 1 180px", minWidth: 0 }}
            maxLength={2000}
            showCount
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={addNote}>
            添加标注
          </Button>
        </div>
        {c.timeline?.length ? (
          <div className="space-y-3">
            {c.timeline.map((n) => (
              <div key={n.id} className="flex justify-between rounded-md border border-terminal-line bg-terminal-canvas p-3">
                <div>
                  <div className="text-xs text-terminal-muted">{new Date(n.date).toLocaleDateString()}</div>
                  <div className="mt-1">{n.content}</div>
                </div>
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteNote(n.id)} />
              </div>
            ))}
          </div>
        ) : (
          <Empty description="暂无标注 — 第一条人文画像，从写下今天的判断开始。" />
        )}
      </Card>

      </>}

      {attribution && <ValuationAttributionPanel key={c.id} companyId={c.id} />}
      </div>
    </div>
  );
}
