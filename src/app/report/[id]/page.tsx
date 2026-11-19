"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import DiagnosisBadge from "@/components/diagnosis-badge";
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
  CheckCircleFilled,
  CloseCircleFilled,
  CopyOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
} from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import AppHeader from "@/components/app-header";
import { ValueDonut, FcfBars, TrendChart, ConfidenceChart } from "@/components/charts";
import {
  PeerCompareChart,
  ValidationGauge,
  SensitivityHeatmap,
} from "@/components/validation-charts";
import { calcDcf } from "@/lib/dcf";
import type { DcfOutput, MonteCarloResult } from "@/types/dcf";

const { Title, Paragraph, Text } = Typography;

/** 数据库里偶尔有空值，格式化一律走这里，避免 undefined.toFixed 把整页打崩 */
const num = (v: unknown, d = 1) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—";

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

function buildSensitivityColumns(label: string) {
  return [
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
}

const TimelineCard = memo(function TimelineCard({
  companyId,
  timeline,
  onChanged,
}: {
  companyId: string;
  timeline: CompanyData["timeline"];
  onChanged: () => void;
}) {
  const { message } = App.useApp();
  const [noteDate, setNoteDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [noteContent, setNoteContent] = useState("");

  const addNote = async () => {
    if (!noteContent.trim()) {
      message.warning("请填写记录内容");
      return;
    }
    const res = await fetch(`/api/companies/${companyId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: noteDate, content: noteContent }),
    });
    if (res.ok) {
      message.success("已添加记录");
      setNoteContent("");
      onChanged();
    } else {
      message.error("添加失败");
    }
  };

  const deleteNote = async (noteId: string) => {
    const res = await fetch(`/api/companies/${companyId}/notes/${noteId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      message.success("已删除");
      onChanged();
    } else {
      message.error("删除失败");
    }
  };

  return (
    <Card
      title="七、复盘时间线"
      extra={`共 ${timeline?.length ?? 0} 条`}
      className="mb-4"
    >
      <div className="mb-4 flex gap-2 flex-wrap">
        <Input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} style={{ width: 160 }} />
        <Input.TextArea
          rows={2}
          placeholder="记录判断、依据与下次验证点"
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
      {timeline?.length ? (
        <div className="space-y-3">
          {timeline.map((n) => (
            <div key={n.id} className="p-3 rounded-inst border flex justify-between" style={{ background: "var(--side)" }}>
              <div>
                <div className="text-xs text-muted">{new Date(n.date).toLocaleDateString()}</div>
                <div className="mt-1">{n.content}</div>
              </div>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteNote(n.id)} />
            </div>
          ))}
        </div>
      ) : (
        <Empty description="暂无标注" />
      )}
    </Card>
  );
});

export default function ReportPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [knobPayout, setKnobPayout] = useState(0.7);
  const [knobExitPe, setKnobExitPe] = useState(7);
  const [knobG, setKnobG] = useState(0.012);
  const [prices, setPrices] = useState<{ date: string; close: number }[]>([]);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [mcLoading, setMcLoading] = useState(false);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const { message } = App.useApp();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/companies/${id}`, { cache: "no-store" });
      if (!res.ok) {
        setCompany(null);
        setLoadError(
          res.status === 404
            ? "这个标的已不存在（可能被合并或删除），请回看板重新选择。"
            : "标的数据加载失败，请稍后重试。",
        );
        return;
      }
      const json = await res.json();
      if (!json?.company) {
        setCompany(null);
        setLoadError("这个标的已不存在（可能被合并或删除），请回看板重新选择。");
        return;
      }
      setCompany(json.company);

      try {
        const pRes = await fetch(`/api/companies/${id}/prices`);
        if (pRes.ok) {
          const pJson = await pRes.json();
          setPrices(Array.isArray(pJson?.prices) ? pJson.prices : []);
        }
      } catch {
        /* 价格序列缺失不影响报告主体 */
      }
    } catch {
      setCompany(null);
      setLoadError("标的数据加载失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

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

  const knobOutput = useMemo(() => {
    if (!company?.assumption) return null;
    try {
      const a = { ...company.assumption, payoutRate2: knobPayout, exitPe: knobExitPe, perpetualG: knobG };
      return calcDcf(a, {
        currentPrice: company.currentPrice,
        shares: company.shares,
        netCash: company.netCash,
        e0: company.e0,
      });
    } catch (e) {
      // 旋钮组合可能落到非法参数（如 Ke ≤ g），不能让整页崩掉
      console.error("旋钮 DCF 计算失败:", e);
      return null;
    }
  }, [company, knobPayout, knobExitPe, knobG]);

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

  const sensitivityColsR = useMemo(() => buildSensitivityColumns("折现率"), []);
  const sensitivityColsPe = useMemo(() => buildSensitivityColumns("退出PE"), []);
  const sensitivityColsG = useMemo(() => buildSensitivityColumns("永续g"), []);

  if (loading)
    return (
      <AppHeader title="估值报告">
        <div className="p-10 text-center">
          <Spin />
        </div>
      </AppHeader>
    );
  if (!company)
    return (
      <AppHeader title="估值报告">
        <div className="p-10 text-center">
          <Empty description={loadError || "标的不存在"} />
          <Button className="mt-4" onClick={() => router.push("/dashboard")}>
            返回看板
          </Button>
        </div>
      </AppHeader>
    );

  const c = company;
  const f = output?.forward;
  const r = output?.reverse;
  const g = output?.gordon;
  const sens = output?.sensitivity;

  const dividend0 = f?.rows[0]?.dividend ?? 0;
  const dividendYield = c.marketCap ? (dividend0 / c.marketCap) * 100 : 0;
  const terminalShare = c.marketCap && f ? (f.pvTerminal / c.marketCap) * 100 : 0;
  const capexRatio = c.da ? c.capex / c.da : 0;

  const copyPrompt = (text: string) => {
    navigator.clipboard.writeText(text).then(() => message.success("已复制提示词"));
  };

  return (
    <AppHeader
      title={`${c.name}（${c.ticker}）`}
      actions={
        <Button
          icon={<EditOutlined />}
          onClick={() => router.push(`/model/edit?id=${id}`)}
        >
          改假设
        </Button>
      }
    >
      <div className="w-full max-w-[1400px] mx-auto">
        {/* 核心指标卡 */}
        <Row gutter={[16, 16]} className="mb-4">
          <Col xs={12} md={6}>
            <Card>
              <Statistic title="当前股价 / 市值" value={c.currentPrice} precision={2} prefix="¥" />
              <div className="text-xs text-muted">{num(c.marketCap)} 亿 ｜ 总股本 {num(c.shares, 2)} 亿股</div>
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card style={{ borderLeft: "4px solid var(--brand)" }}>
              <Statistic
                title="★调整后潜在空间（股东回报口径）"
                value={c.upside}
                precision={1}
                suffix="%"
                prefix={c.upside >= 0 ? "+" : ""}
                styles={{ content: { color: c.upside >= 0 ? "var(--brand)" : "var(--brick)" } }}
              />
              <div className="text-xs text-muted">合理目标价：¥{num(c.targetPrice, 2)}</div>
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
                styles={{ content: { color: "var(--brand)" } }}
              />
              <div className="text-xs text-muted">原版合理价：¥{(f?.originalTargetPrice ?? 0).toFixed(2)}</div>
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic title="WACC 加权资本成本" value={c.wacc * 100} precision={2} suffix="%" styles={{ content: { color: "var(--khaki)" } }} />
              <div className="text-xs text-muted">Ke {num((c.forwardKe ?? NaN) * 100)}% ｜ Kd 税后 {num((c.kd ?? NaN) * (1 - (c.taxRate ?? 0)) * 100, 2)}%</div>
            </Card>
          </Col>
        </Row>

        {/* 股价 vs DCF 估值趋势图 */}
        {prices.length > 0 && (
          <Card
            title="股价与 DCF 估值趋势"
            className="mb-4"
          >
            <TrendChart
              prices={prices}
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
              message={g.reason}
            />
          </Card>
        )}

        {/* 三旋钮解算 */}
        <Card title="三旋钮解算" className="mb-4">
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card size="small" style={{ background: "var(--brand-soft)" }}>
                <div className="text-sm">① 派现率 — {knobPayout >= 0.7 ? "75%" : "50%"}（当前 {(knobPayout * 100).toFixed(0)}%）</div>
                <Button size="small" onClick={() => setKnobPayout(knobPayout >= 0.7 ? 0.5 : 0.75)}>
                  切换派现率
                </Button>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" style={{ background: "var(--side)" }}>
                <div className="text-sm">② Exit PE — 当前 {knobExitPe}x</div>
                <Button size="small" onClick={() => setKnobExitPe(knobExitPe >= 7 ? 4.7 : 7)}>
                  切换 Exit PE
                </Button>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" style={{ background: "var(--side)" }}>
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
              style={{ marginTop: 16 }}
              message={`旋钮调整后：隐含 Ke ${(knobOutput.reverse.impliedKe * 100).toFixed(1)}%，目标价 ¥${knobOutput.forward.adjustedTargetPrice.toFixed(2)}（${knobOutput.forward.adjustedUpside >= 0 ? "+" : ""}${knobOutput.forward.adjustedUpside.toFixed(1)}%）`}
            />
          )}
        </Card>

        {/* 一、正向 DCF 价值拆解 */}
        <Card
          title="一、正向 DCF"
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
              <Statistic title="净现金 (现金-负债+调整)" value={f?.composition.netCash} precision={1} suffix="亿" styles={{ content: { color: "var(--brand)" } }} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="DCF 实体价值 EV" value={f?.originalEv} precision={1} suffix="亿" styles={{ content: { color: "var(--brand-deep)" } }} />
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
            title="二、逆向 DCF"
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
                  render: () => <DiagnosisBadge value={c.diagnosis} />,
                },
                { title: "终局敏感度", render: () => "-" },
              ]}
              dataSource={sens.r.map((cell) => ({ ...cell, key: cell.param }))}
            />

            <Divider>三、三变量敏感性矩阵 · 隐含终局利润 L 对关键参数的弹性</Divider>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <Card size="small" title="① L_conservative 对折现率 r">
                  <Table size="small" pagination={false} columns={sensitivityColsR} dataSource={sens.r.map((x) => ({ ...x, param: `${(x.param * 100).toFixed(0)}%`, key: x.param }))} />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card size="small" title="② L_multiple 对退出 PE">
                  <Table size="small" pagination={false} columns={sensitivityColsPe} dataSource={sens.exitPe.map((x) => ({ ...x, param: `${x.param}x`, key: x.param }))} />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card size="small" title="③ L_gordon 对永续 g">
                  <Table size="small" pagination={false} columns={sensitivityColsG} dataSource={sens.g.map((x) => ({ ...x, param: `${(x.param * 100).toFixed(0)}%`, key: x.param }))} />
                </Card>
              </Col>
            </Row>
          </Card>
        )}

        {/* 蒙特卡洛置信区间 */}
        <Card
          title="四、蒙特卡洛置信区间"
          extra={
            <Space>
              <Tag color="red">P5 ¥{mcResult?.p5?.toFixed(2) ?? "-"}</Tag>
              <Tag color="blue">中位数 ¥{mcResult?.median?.toFixed(2) ?? "-"}</Tag>
              <Tag color="green">P95 ¥{mcResult?.p95?.toFixed(2) ?? "-"}</Tag>
            </Space>
          }
          className="mb-4"
        >
          {mcLoading ? (
            <div className="text-center py-8"><Spin tip="蒙特卡洛模拟中（3000 次采样）..." /></div>
          ) : mcResult ? (
            <div>
              <ConfidenceChart mc={mcResult} currentPrice={c.currentPrice} />
              <Row gutter={[16, 8]} className="mt-4">
                <Col span={6}><Statistic title="P5（保守）" value={mcResult.p5} precision={2} prefix="¥" styles={{ content: { color: "var(--brick)" } }} /></Col>
                <Col span={6}><Statistic title="P25" value={mcResult.p25} precision={2} prefix="¥" /></Col>
                <Col span={6}><Statistic title="中位数" value={mcResult.median} precision={2} prefix="¥" styles={{ content: { color: "var(--brand)" } }} /></Col>
                <Col span={6}><Statistic title="P95（乐观）" value={mcResult.p95} precision={2} prefix="¥" styles={{ content: { color: "var(--brand)" } }} /></Col>
              </Row>
              <Alert
                className="mt-3"
                type={mcResult.pricePercentile > 75 ? "warning" : mcResult.pricePercentile < 25 ? "success" : "info"}
                showIcon
                message={`当前市价处于分布的第 ${mcResult.pricePercentile.toFixed(0)} 分位`}
              />
            </div>
          ) : (
            <Empty description="置信区间计算失败" />
          )}
        </Card>

        {/* 估值验证（绝对 × 相对 交叉验证） */}
        <Card
          title="五、估值验证"
          extra={
            <Tag color={validation?.validation?.conclusion === "一致" ? "green" : "orange"}>
              {validation?.validation?.conclusion ?? "计算中"}
            </Tag>
          }
          className="mb-4"
        >
          {validationLoading ? (
            <div className="text-center py-8">
              <Spin tip="正在交叉验证并生成 AI 归因（≤30秒）..." />
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
                          color: validation.validation.premiumDiscount > 0 ? "var(--brick)" : "var(--brand)",
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
                  title="AI 归因分析"
                  className="mt-4"
                  style={{
                    borderColor: validation.validation.diffRate >= 20 ? "var(--khaki)" : "var(--brand)",
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
                  <div className="text-center py-8 text-muted">热力图数据加载中…</div>
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
            title="六、公司画像"
            className="mb-4"
          >
            <div className="space-y-2">
              <p><Text strong>定位：</Text>{profile.positioning}</p>
              <p><Text strong>财务结构：</Text>{profile.body}</p>
              <p><Text strong>市场隐含：</Text>{profile.marketBet}</p>
              <p><Text strong>模型测算：</Text>{profile.modelSays}</p>
              <p><Text strong>自洽校验：</Text><span className={g?.isConsistent ? "txt-pos" : "txt-neg"}>{profile.check}</span></p>
            </div>
            <Button
              type="primary"
              icon={<CopyOutlined />}
              className="mt-3"
              onClick={() => copyPrompt(`你是一位资深卖方分析师。请基于以下公司画像，输出一份 300 字的深度画像：\n定位：${profile.positioning}\n财务结构：${profile.body}\n市场隐含：${profile.marketBet}\n模型测算：${profile.modelSays}`)}
            >
              复制画像提示词
            </Button>
          </Card>
        )}

        <TimelineCard companyId={id} timeline={c.timeline ?? []} onChanged={load} />

        {/* 八、预期差解构 */}
        <Card
          title="八、预期差解构"
          className="mb-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card size="small" title="Capex/D&A">
              <div className="text-2xl font-bold text-brand font-mono-num">{capexRatio.toFixed(2)}</div>
              <div className="text-xs text-muted mt-1">
                折旧 {c.da.toFixed(0)} 亿 / 资本开支 {c.capex.toFixed(0)} 亿
              </div>
            </Card>
            <Card size="small" title="股息率">
              <div className="text-2xl font-bold text-brand font-mono-num">{dividendYield.toFixed(1)}%</div>
              <div className="text-xs text-muted mt-1">
                首年分红 {dividend0.toFixed(0)} 亿 / 市值 {c.marketCap.toFixed(0)} 亿
              </div>
            </Card>
            <Card size="small" title="永续价值占比">
              <div className="text-2xl font-bold text-brand font-mono-num">{terminalShare.toFixed(1)}%</div>
              <div className="text-xs text-muted mt-1">
                永续现值 {(f?.pvTerminal ?? 0).toFixed(0)} 亿 / 市值
              </div>
            </Card>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              icon={<CopyOutlined />}
              onClick={() =>
                copyPrompt(
                  `请用大白话解读这份 DCF 预期差：目标价 ¥${num(c.targetPrice, 2)}（${num(c.upside, 1)}%），隐含终局利润 L=${num(r?.l, 0)}亿，L/E3=${num(r?.lE3, 1)}x。300 字以内。`,
                )
              }
            >
              复制 AI 解读提示词
            </Button>
          </div>
        </Card>
      </div>
    </AppHeader>
  );
}
