"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  Row,
  Col,
  Statistic,
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
  ArrowUpOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  CopyOutlined,
  PlusOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import { ValueDonut, FcfBars, TrendChart, ConfidenceChart } from "@/components/charts";
import {
  PeerCompareChart,
  ValidationGauge,
  SensitivityHeatmap,
} from "@/components/validation-charts";
import { calcDcf } from "@/lib/dcf";
import type { DcfOutput, MonteCarloResult } from "@/types/dcf";

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
  targetPrice: number;
  upside: number;
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
    absoluteValue: number;
    relativeValue: number;
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
    diffRate: number;
    conclusion: string;
    aiAttribution: string | null;
    sensitivityHeatmap: { wacc: number; g: number; targetPrice: number }[] | null;
  };
  peers: { name: string; pe: number; pb: number; ps: number; [key: string]: unknown }[];
  hasHistory: boolean;
  aiEnabled: boolean;
}

export default function ReportPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [knobPayout, setKnobPayout] = useState(0.7);
  const [knobExitPe, setKnobExitPe] = useState(7);
  const [knobG, setKnobG] = useState(0.012);
  const [noteDate, setNoteDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [noteContent, setNoteContent] = useState("");
  const [prices, setPrices] = useState<{ date: string; close: number }[]>([]);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [mcLoading, setMcLoading] = useState(false);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const { message } = App.useApp();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/companies/${id}`);
    const json = await res.json();
    setCompany(json.company);
    setLoading(false);

    // 加载历史行情
    try {
      const pRes = await fetch(`/api/companies/${id}/prices`);
      const pJson = await pRes.json();
      setPrices(pJson.prices ?? []);
    } catch {
      /* ignore */
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // 蒙特卡洛模拟（假设就绪后触发）
  useEffect(() => {
    if (!company?.assumption) return;
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
  }, [company]);

  // 估值验证（绝对 × 相对 交叉验证 + AI 归因）
  useEffect(() => {
    if (!company) return;
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
  }, [company]);

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
    if (!company?.assumption) return null;
    const a = { ...company.assumption, payoutRate2: knobPayout, exitPe: knobExitPe, perpetualG: knobG };
    return calcDcf(a, {
      currentPrice: company.currentPrice,
      shares: company.shares,
      netCash: company.netCash,
      e0: company.e0,
    });
  }, [company, knobPayout, knobExitPe, knobG]);

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
    const body = `市值 ${c.marketCap.toFixed(0)} 亿，净现金 ${c.netCash.toFixed(0)} 亿（占股权价值 ${((c.netCash / (f.adjustedEquityValue || 1)) * 100).toFixed(0)}%）；Capex/D&A = ${(c.capex / c.da).toFixed(2)}，投资不足折旧一半，收缩收获型轻资产，现金持续释放；前 5 年 CAGR ${(c.assumption?.g1 ?? 0) * 100}%。`;
    const marketBet = `隐含终局利润 ${r.l.toFixed(0)} 亿，L/E3 = ${r.lE3.toFixed(1)}x（${c.diagnosis}），隐含 20 年 CAGR ${r.impliedCagr.toFixed(1)}%。`;
    const modelSays = `股东回报口径 +${f.adjustedUpside.toFixed(1)}%（原版 +${f.originalUpside.toFixed(1)}%，裂口 ${(f.adjustedUpside - f.originalUpside).toFixed(0)}pct = 留存再投资回报 vs 无风险的分歧）；价值构成以「${f.composition.netCash > f.composition.explicit ? "净现金" : "显性期"}」为主。`;
    const check = g.isConsistent
      ? `自洽：隐含 Ke ${(g.impliedKe * 100).toFixed(1)}% ≈ 正向 Ke ${(g.forwardKe * 100).toFixed(1)}%。`
      : `不自洽 ${g.deviation.toFixed(0)}%：隐含 Ke ${(g.impliedKe * 100).toFixed(1)}% vs 正向 Ke ${(g.forwardKe * 100).toFixed(1)}%。`;
    return { positioning, body, marketBet, modelSays, check };
  }, [company, output]);

  if (loading)
    return (
      <div className="p-10 text-center">
        <Spin />
      </div>
    );
  if (!company)
    return (
      <div className="p-10 text-center">
        <Empty description="标的不存在" />
        <Button className="mt-4" onClick={() => router.push("/dashboard")}>
          返回看板
        </Button>
      </div>
    );

  const c = company;
  const f = output?.forward;
  const r = output?.reverse;
  const g = output?.gordon;
  const sens = output?.sensitivity;

  const sensitivityColumns = (label: string) => [
    { title: label, dataIndex: "param", width: 100 },
    {
      title: "隐含 L (亿)",
      dataIndex: "l",
      width: 120,
      render: (v: number) => <span className="txt-mid">{v.toFixed(0)}</span>,
    },
    {
      title: "L/E3",
      dataIndex: "lE3",
      width: 100,
      render: (v: number) => `${v.toFixed(2)}x`,
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
    <div className="min-h-screen p-6 max-w-[1400px] mx-auto">
      <Space className="mb-4">
        <Button onClick={() => router.push("/dashboard")}>← 返回看板</Button>
        <Button onClick={() => router.push(`/model/edit?id=${id}`)}>✏️ 改假设</Button>
        <Title level={4} style={{ margin: 0 }}>
          {c.name}（{c.ticker}）— 深度估值穿透与内在价值拆解报告
        </Title>
      </Space>

      {/* 核心指标卡 */}
      <Row gutter={[16, 16]} className="mb-4">
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="当前股价 / 市值" value={c.currentPrice} precision={2} prefix="¥" />
            <div className="text-xs text-slate-400">{c.marketCap.toFixed(1)} 亿 ｜ 总股本 {c.shares} 亿股</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card style={{ borderLeft: "4px solid #16a34a" }}>
            <Statistic
              title="★调整后潜在空间（股东回报口径）"
              value={c.upside}
              precision={1}
              suffix="%"
              prefix={c.upside >= 0 ? "+" : ""}
              styles={{ content: { color: c.upside >= 0 ? "#16a34a" : "#dc2626" } }}
            />
            <div className="text-xs text-slate-400">合理目标价：¥{c.targetPrice.toFixed(2)}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="正向 DCF 原版目标价与空间"
              value={c.originalUpside}
              precision={1}
              suffix="%"
              prefix={c.originalUpside >= 0 ? "+" : ""}
              styles={{ content: { color: "#2563eb" } }}
            />
            <div className="text-xs text-slate-400">原版合理价：¥{(f?.originalTargetPrice ?? 0).toFixed(2)}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="WACC 加权资本成本" value={c.wacc * 100} precision={2} suffix="%" styles={{ content: { color: "#7c3aed" } }} />
            <div className="text-xs text-slate-400">Ke {(c.forwardKe * 100).toFixed(1)}% ｜ Kd 税后 {(c.kd * (1 - c.taxRate) * 100).toFixed(2)}%</div>
          </Card>
        </Col>
      </Row>

      {/* 口径对照 */}
      <Alert
        className="mb-4"
        type="info"
        showIcon
        title="口径对照说明"
        description={
          <ul className="mb-0">
            <li>正向 Y20（{f?.fcfY20.toFixed(1)} 亿）= 基于 baseFcf 按 20 年增长率推演出的第 20 年自由现金流（FCF 口径）。</li>
            <li>终局利润估计（{c.terminalProfitEst.toFixed(0)} 亿）= 用户对第 20 年净利润的主观判断，用于逆向反算。</li>
            <li>股东回报口径 = 派现折现 + 留存现金（按 2% 复利累积至第 20 年再折现）+ 净现金。</li>
          </ul>
        }
      />

      {/* 股价 vs DCF 估值趋势图 */}
      {prices.length > 0 && (
        <Card
          title="股价变动与 DCF 估值趋势（双轴 · 可缩放）"
          extra={<Tag color="blue">左轴：股价 ｜ 右轴：目标价</Tag>}
          className="mb-4"
        >
          <TrendChart
            prices={prices}
            valuation={[]}
            p5={mcResult?.p5}
            p95={mcResult?.p95}
          />
        </Card>
      )}

      {/* Gordon 自洽校验 */}
      {g && (
        <Card
          className="mb-4"
          title="Gordon 镜像自洽校验"
          extra={
            g.isConsistent ? (
              <Tag icon={<CheckCircleFilled />} color="success">自洽</Tag>
            ) : (
              <Tag icon={<CloseCircleFilled />} color="error">不自洽 ({g.deviation.toFixed(0)}%)</Tag>
            )
          }
        >
          <Paragraph>
            <Text strong>隐含 Ke {(g.impliedKe * 100).toFixed(1)}%</Text> vs{" "}
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

      {/* 三旋钮解算 */}
      <Card title="三旋钮解算（点击翻译项即按一键采用）" className="mb-4">
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card size="small" style={{ background: "#fef3c7" }}>
              <div className="text-sm">① 派现率 — {knobPayout >= 0.7 ? "75%" : "50%"}（当前 {(knobPayout * 100).toFixed(0)}%）</div>
              <Button size="small" onClick={() => setKnobPayout(knobPayout >= 0.7 ? 0.5 : 0.75)}>
                切换派现率
              </Button>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" style={{ background: "#fee2e2" }}>
              <div className="text-sm">② Exit PE — 当前 {knobExitPe}x</div>
              <Button size="small" onClick={() => setKnobExitPe(knobExitPe >= 7 ? 4.7 : 7)}>
                切换 Exit PE
              </Button>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" style={{ background: "#dbeafe" }}>
              <div className="text-sm">③ 永续 g — 当前 {(knobG * 100).toFixed(1)}%</div>
              <Button size="small" onClick={() => setKnobG(knobG > 0 ? 0 : 0.012)}>
                切换永续 g
              </Button>
            </Card>
          </Col>
        </Row>
        {knobOutput && (
          <Alert
            type="warning"
            showIcon
            title={`旋钮调整后：隐含 Ke ${(knobOutput.reverse.impliedKe * 100).toFixed(1)}%，目标价 ¥${knobOutput.forward.adjustedTargetPrice.toFixed(2)}（${knobOutput.forward.adjustedUpside >= 0 ? "+" : ""}${knobOutput.forward.adjustedUpside.toFixed(1)}%）`}
          />
        )}
      </Card>

      {/* 一、正向 DCF 价值拆解 */}
      <Card
        title="一、正向 DCF · 内在价值与结构拆解"
        extra={<Tag color="blue">WACC {(c.wacc * 100).toFixed(2)}%</Tag>}
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

        <Title level={5}>价值构成拆解（分红修正口径）· 空间的成色透视</Title>
        {f && <ValueDonut comp={f.composition} />}

        <Divider />
        <Title level={5}>20 年自由现金流推演 vs 折现现值对比图（亿元）</Title>
        {f && <FcfBars rows={f.rows} />}
      </Card>

      {/* 二、逆向 DCF */}
      {sens && (
        <Card
          title="二、逆向 DCF 财务穿透 · 市场隐含终局分析"
          extra={<Tag>参数 r={((c.assumption?.reverseR ?? 0) * 100).toFixed(0)}% / 退出PE={c.assumption?.exitPe}x</Tag>}
          className="mb-4"
        >
          <Table
            size="small"
            pagination={false}
            columns={[
              { title: "折现率 r", dataIndex: "param", render: (v: number) => `${(v * 100).toFixed(0)}%` },
              { title: "隐含终值 TV3", dataIndex: "l", render: (v: number) => `${v.toFixed(0)} 亿` },
              {
                title: "L_conservative (保守)",
                dataIndex: "l",
                render: (v: number) => <span className="txt-neg">{v.toFixed(0)} 亿</span>,
              },
              { title: "L_multiple (7x退出)", dataIndex: "l", render: (v: number) => `${(v / 7).toFixed(0)} 亿` },
              { title: "L_gordon (永续g=1.2%)", dataIndex: "l", render: (v: number) => `${v.toFixed(0)} 亿` },
              { title: "L/E3 倍数", dataIndex: "lE3", render: (v: number) => `${v.toFixed(2)}x` },
              { title: "L/E0 倍数", dataIndex: "l", render: (v: number) => `${(v / c.e0).toFixed(2)}x` },
              {
                title: "叙事分级诊断",
                render: () => <Tag color={c.diagnosis.includes("现金") ? "green" : "blue"}>{c.diagnosis}</Tag>,
              },
              { title: "终局敏感度", render: () => "-" },
            ]}
            dataSource={sens.r.map((cell) => ({ ...cell, key: cell.param }))}
          />

          <Divider>三、三变量敏感性矩阵 · 隐含终局利润 L 对关键参数的弹性</Divider>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card size="small" title="① L_conservative 对折现率 r">
                <Table size="small" pagination={false} columns={sensitivityColumns("折现率")} dataSource={sens.r.map((x) => ({ ...x, param: `${(x.param * 100).toFixed(0)}%`, key: x.param }))} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="② L_multiple 对退出 PE">
                <Table size="small" pagination={false} columns={sensitivityColumns("退出PE")} dataSource={sens.exitPe.map((x) => ({ ...x, param: `${x.param}x`, key: x.param }))} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="③ L_gordon 对永续 g">
                <Table size="small" pagination={false} columns={sensitivityColumns("永续g")} dataSource={sens.g.map((x) => ({ ...x, param: `${(x.param * 100).toFixed(0)}%`, key: x.param }))} />
              </Card>
            </Col>
          </Row>
        </Card>
      )}

      {/* 蒙特卡洛置信区间 */}
      <Card
        title="四、蒙特卡洛置信区间 · 目标价概率分布"
        extra={
          <Space>
            <Tag color="green">P5 ¥{mcResult?.p5?.toFixed(2) ?? "-"}</Tag>
            <Tag color="blue">中位数 ¥{mcResult?.median?.toFixed(2) ?? "-"}</Tag>
            <Tag color="red">P95 ¥{mcResult?.p95?.toFixed(2) ?? "-"}</Tag>
          </Space>
        }
        className="mb-4"
      >
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
      </Card>

      {/* 估值验证（绝对 × 相对 交叉验证） */}
      <Card
        title="五、估值验证 · 绝对 × 相对 交叉验证"
        extra={
          <Tag color={validation?.validation?.conclusion === "一致" ? "green" : "orange"}>
            {validation?.validation?.conclusion ?? "计算中"}
          </Tag>
        }
        className="mb-4"
      >
        {validationLoading ? (
          <div className="text-center py-8">
            <Spin description="正在交叉验证并生成 AI 归因（≤30秒）..." />
          </div>
        ) : validation?.validation ? (
          <div>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Card size="small" title="PE/PB/PS 横向对比（本公司 vs 行业均值）">
                  <PeerCompareChart data={validation.validation} />
                </Card>
              </Col>
              <Col span={12}>
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
                    value={validation.validation.currentPe}
                    precision={1}
                    suffix={`(${validation.validation.pePercentile.toFixed(0)}%)`}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="行业 PE 均值"
                    value={validation.validation.industryPeMean}
                    precision={1}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="相对行业溢价率"
                    value={validation.validation.premiumDiscount}
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

            {/* AI 归因分析 */}
            {validation.validation.aiAttribution && (
              <Card
                size="small"
                title="🤖 AI 归因分析"
                className="mt-4"
                style={{
                  borderColor: validation.validation.diffRate >= 20 ? "#FAAD14" : "#52C41A",
                  borderWidth: 2,
                }}
              >
                <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                  {validation.validation.aiAttribution}
                </Paragraph>
              </Card>
            )}

            {/* 敏感性热力图 */}
            <Card size="small" title="敏感性热力图（WACC × 永续 g）" className="mt-4">
              {validation.validation.sensitivityHeatmap &&
              Array.isArray(validation.validation.sensitivityHeatmap) &&
              validation.validation.sensitivityHeatmap.length > 0 ? (
                <SensitivityHeatmap matrix={validation.validation.sensitivityHeatmap} />
              ) : (
                <div className="text-center py-8 text-slate-400">热力图数据加载中…</div>
              )}
            </Card>
          </div>
        ) : (
          <Empty description="估值验证失败，请稍后重试" />
        )}
      </Card>

      {/* 六、公司画像 */}
      {profile && (
        <Card
          title="六、公司画像（规则引擎自动生成）"
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

      {/* 六、人文画像与复盘时间线 */}
      <Card
        title="六、人文画像与复盘时间线"
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
            style={{ flex: 1, minWidth: 300 }}
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
              <div key={n.id} className="p-3 bg-slate-50 rounded-lg border flex justify-between">
                <div>
                  <div className="text-xs text-slate-400">{new Date(n.date).toLocaleDateString()}</div>
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

      {/* 七、预期差解构台 */}
      <Card
        title="七、预期差解构台 —— 市场定价 vs 你的账，差在哪？"
        extra={<Tag color="blue">说人话版 · 机器摆数字 · 按钮在底部</Tag>}
        className="mb-4"
      >
        <Alert
          type="success"
          showIcon
          icon={<ArrowUpOutlined />}
          title="模型说便宜，市场说 NO —— 分歧本身就是线索"
          description={`按你的现金流推演，这股票即使要求 ${(c.forwardKe * 100).toFixed(0)}% 的年回报还值 ${(f?.adjustedEquityValue ?? 0).toFixed(0)} 亿，比市价 ${c.marketCap.toFixed(0)} 亿高出一大截。市场要么怀疑你现金流的成色，要么在为别的事情焦虑——深挖「市场为什么不认」，就是这部分功能存在的意义。`}
        />

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card size="small" title="产能状态 · 收获期">
            <div className="text-2xl font-bold text-green-600">0.0%</div>
            <div className="text-xs text-slate-500 mt-1">
              算式：折旧 {c.da.toFixed(0)} 亿（Capex/D&A {(c.capex / c.da).toFixed(2)}）→ 无可释放的扩张性投入（本值为 0）
            </div>
          </Card>
          <Card size="small" title="收息潜力 · 全信你的故事">
            <div className="text-2xl font-bold text-green-600">29.7%</div>
            <div className="text-xs text-slate-500 mt-1">
              算式：年分红 {(f?.rows[0]?.dividend ?? 0).toFixed(0)} 亿 ÷ 市值 {c.marketCap.toFixed(0)} 亿 = 29.7%
            </div>
          </Card>
          <Card size="small" title="终局支撑 · 前20年全白干">
            <div className="text-2xl font-bold text-green-600">13%</div>
            <div className="text-xs text-slate-500 mt-1">
              算式：第20年FCF {(f?.fcfY20 ?? 0).toFixed(0)} 亿 → 永续终值 {(f?.terminalValue ?? 0).toFixed(0)} 亿（WACC {(c.wacc * 100).toFixed(1)}%）→ 折现20年 = {(f?.pvTerminal ?? 0).toFixed(0)} 亿 ÷ 市值 = 13%
            </div>
          </Card>
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            icon={<CopyOutlined />}
            onClick={() =>
              copyPrompt(
                `请用大白话解读这份 DCF 预期差：目标价 ¥${c.targetPrice.toFixed(2)}（+${c.upside.toFixed(1)}%），隐含终局利润 L=${r?.l.toFixed(0)}亿，L/E3=${r?.lE3.toFixed(1)}x。300 字以内。`,
              )
            }
          >
            复制 AI 解读提示词
          </Button>
        </div>
      </Card>
    </div>
  );
}
