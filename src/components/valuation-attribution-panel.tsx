"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Collapse, Descriptions, Spin, Typography } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import Link from "next/link";
import { attributionTopics, availableAttributionTopics, scenarioEvidence, type AttributionModel, type ValuationAttributionAnalysis,
  type ValuationAttributionEvidence } from "@/lib/valuation-attribution";

const endpoint = "/api/validation/attribution";
const percent = (value: number) => `${value.toFixed(2)}%`;
const serviceUnavailable = "分析服务暂时不可用，请稍后重试";

type EvidenceResponse = { evidence: ValuationAttributionEvidence; configured: boolean };
const perShare = (price: number, currency: string) => `${price.toFixed(2)} ${currency}/股`;
const quoteSources = { eastmoney: "东方财富", ifind: "同花顺 iFinD", published: "底稿保存的同日报价" };
const scenarioLabel = (kind: AttributionModel["kind"], driver: "rate" | "growth", shift: number) =>
  `${driver === "growth" ? "永续增长率" : kind === "operating" ? "WACC" : "Ke"} ${shift > 0 ? "上调" : "下调"} ${Math.abs(shift * 100)} 个百分点`;

function MarketComparison({ evidence }: { evidence: ValuationAttributionEvidence }) {
  const { comparison, primary, model } = evidence;
  const { quote, direction, mode, difference, differencePct, valuationDate } = comparison;
  const price = primary.price;
  const scenarios = scenarioEvidence(evidence);
  const basis = primary.kind === "operating" ? "经营估值" : "简化估值参考";
  const quoteLabel = quote?.source === "published" ? "底稿同日报价" : "最近可核验收盘价";
  const title = mode === "unavailable" ? "暂无法判断估值与股价的方向"
    : `${mode === "reference" ? "参考对照 · " : ""}${basis}${direction === "above" ? "高于" : direction === "below" ? "低于" : "与"}${quoteLabel}${direction === "flat" ? "接近" : ""}`;
  return <Alert className="mb-3" showIcon type={mode === "reference" ? "warning" : "info"} title={title} description={
    <div className="space-y-1">
      {price !== null && quote && direction && <div className="font-mono">
        {perShare(price, quote.currency)} 对比 {perShare(quote.price, quote.currency)}
        {difference !== null && ` · 每股差额 ${difference > 0 ? "+" : ""}${perShare(difference, quote.currency)}`}
        {differencePct !== null && `（${differencePct > 0 ? "+" : ""}${percent(differencePct)}）`}
      </div>}
      {quote && <div>{quoteLabel} {quote.date} · {quoteSources[quote.source]}{!direction && ` · ${perShare(quote.price, quote.currency)}`}
        {valuationDate && ` · ${primary.kind === "legacy" ? "模型计算日" : "估值基准日"} ${valuationDate}`}</div>}
      {comparison.reason && <div>{comparison.reason}</div>}
      {model && quote && scenarios.length > 0 && <div>
        <div className="font-medium">调整假设后的估值</div>
        <ul className="list-inside list-disc">
          {scenarios.map(({ driver, shift, price, position }) => <li key={`${driver}:${shift}`}>
            {scenarioLabel(model.kind, driver, shift)} → {perShare(price, quote.currency)}
            {position === "crosses" ? "，跨过对照价" : position === "near" ? "，接近对照价" : "，仍在对照价同一侧"}
          </li>)}
        </ul>
      </div>}
    </div>
  } />;
}

function DriverEvidence({ evidence }: { evidence: ValuationAttributionEvidence }) {
  const { model, peers, announcements } = evidence;
  if (!model && !peers && !announcements.length) return null;
  return <Collapse className="mt-3" size="small" items={[{
    key: "drivers", label: "归因依据", children: <div className="space-y-3">
      {model && <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} items={[
        { key: "explicit", label: model.kind === "operating" ? "显性期 FCFF 现值" : "显性期派现现值", children: perShare(model.explicitPerShare, model.currency) },
        { key: "terminal", label: "终值现值", children: `${perShare(model.terminalPerShare, model.currency)}${model.terminalShare === null ? "" : ` · 占${model.kind === "operating" ? "经营" : "股权"}价值 ${percent(model.terminalShare * 100)}`}` },
        { key: "assets", label: model.kind === "operating" ? "净金融资产" : "净现金", children: perShare(model.netFinancialAssetsPerShare, model.currency) },
        ...(model.minorityPerShare === null ? [] : [{ key: "minority", label: "少数股东权益扣减", children: perShare(model.minorityPerShare, model.currency) }]),
        ...(model.retainedPerShare === null ? [] : [{ key: "retained", label: "留存现金现值", children: perShare(model.retainedPerShare, model.currency) }]),
        ...(model.kind === "legacy" ? [{ key: "rates", label: "Ke / 永续增长", children: `${percent(model.rate * 100)} / ${percent(model.growth * 100)}` }] : []),
        ...(model.impliedGrowth === null ? [] : [{ key: "implied", label: "固定其他假设的同日价格隐含永续增速", children: percent(model.impliedGrowth * 100) }]),
        ...model.sensitivity.map(({ driver, shift, price }) => ({ key: `${driver}:${shift}`,
          label: scenarioLabel(model.kind, driver, shift),
          children: perShare(price, model.currency),
        })),
      ]} />}
      {peers && <div>
        <div className="font-medium">同行倍数 · {peers.industry} · {peers.date}</div>
        <p className="text-xs text-terminal-muted">年报期 {peers.period} · {peers.names.join("、")}</p>
        <ul className="mt-1 list-inside list-disc">
          {peers.multiples.map(({ name, current, median, count }) => <li key={name}>{name} 标的 {current.toFixed(2)} 倍，同行中位数 {median.toFixed(2)} 倍（{count} 家）</li>)}
        </ul>
      </div>}
      {announcements.length > 0 && <div>
        <div className="font-medium">相关公告</div>
        <ul className="mt-1 list-inside list-disc">
          {announcements.map((item, index) => <li key={`${item.date}:${index}`}>
            {item.date} · {item.title}{item.afterModelCutoff && "（晚于底稿资料截止）"}
          </li>)}
        </ul>
      </div>}
    </div>,
  }]} />;
}

function Evidence({ evidence }: { evidence: ValuationAttributionEvidence }) {
  const { primary, terminalGrowth, comparables, reconciliation } = evidence;
  if (primary.kind !== "operating") {
    return <Alert type="info" showIcon
      title={primary.kind === "legacy" ? `简化估值参考：${primary.price.toFixed(2)}/股` : "主估值待核验"}
      description={`${primary.reason} 暂无可用于比较的已发布经营估值。`} />;
  }
  const p = primary.publication;
  const price = (value: number) => `${value.toFixed(2)} ${p.currency}/股`;
  return <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} items={[
    { key: "valuation", label: "已发布经营估值", children: price(primary.price) },
    { key: "date", label: "基准日 / 资料截止", children: `${p.valuationDate} / ${p.informationCutoff}` },
    { key: "rates", label: "WACC / 永续增长", children: `${percent(p.wacc * 100)} / ${terminalGrowth === null ? "待核验" : percent(terminalGrowth * 100)}` },
    { key: "share", label: "终值占经营价值", children: p.terminalValueShare === null ? "—" : percent(p.terminalValueShare * 100) },
    { key: "market", label: "底稿登记的同日报价", children: primary.upside !== null && p.comparableQuote !== null
      ? `${price(p.comparableQuote)} · ${percent(primary.upside)}`
      : p.retrospective ? "部分资料在基准日后可得，不能计算同日差异" : "底稿未登记可比价格" },
    { key: "peers", label: "同行估值交叉验证", children: comparables
      ? `${comparables.equityValueHundredMillions.toFixed(2)} 亿 ${p.currency} · 差异 ${percent(comparables.differencePct)}`
      : "暂无与当前版本、基准日及币种对齐的同行结果" },
    { key: "check", label: "FCFF、ReOI、AOIG 勾稽", children: reconciliation === "passed" ? "已通过" : "底稿待核验" },
  ]} />;
}

export default function ValuationAttributionPanel({ companyId }: { companyId: string }) {
  const [data, setData] = useState<EvidenceResponse>();
  const [evidenceError, setEvidenceError] = useState("");
  const [reload, setReload] = useState(0);
  const [analysis, setAnalysis] = useState<ValuationAttributionAnalysis>();
  const [analysisError, setAnalysisError] = useState("");
  const [running, setRunning] = useState(false);
  const generation = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const request = fetch(`${endpoint}?companyId=${encodeURIComponent(companyId)}`,
      { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
    void request.then(async (response) => {
      if (!response.ok) throw new Error();
      const value: EvidenceResponse = await response.json();
      if (!controller.signal.aborted) setData(value);
    }).catch(() => {
      if (!controller.signal.aborted) setEvidenceError("无法读取估值证据，请稍后重试。");
    });
    return () => { controller.abort(); generation.current?.abort(); };
  }, [companyId, reload]);

  async function run() {
    if (generation.current || !data?.configured) return;
    const controller = new AbortController();
    generation.current = controller;
    setRunning(true);
    setAnalysisError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(40000)]),
        body: JSON.stringify({ companyId }),
      });
      const result = await response.json() as { evidence: ValuationAttributionEvidence; analysis: ValuationAttributionAnalysis; code?: string; error?: string };
      if (!response.ok) throw new Error(result.code === "INSUFFICIENT_EVIDENCE" ? result.error : serviceUnavailable);
      if (!controller.signal.aborted) {
        setData({ evidence: result.evidence, configured: true });
        setAnalysis(result.analysis);
      }
    } catch (error) {
      if (!controller.signal.aborted) setAnalysisError(error instanceof Error && error.name === "Error" ? error.message : serviceUnavailable);
    } finally {
      generation.current = null;
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  return <Card className="mb-4" title="预期差解构台">
    {!data && !evidenceError && <Spin description="正在读取估值证据…" />}
    {evidenceError && <Alert type="warning" showIcon title={evidenceError}
      action={<Button size="small" onClick={() => { setEvidenceError(""); setReload((value) => value + 1); }}>重试</Button>} />}
    {data && <>
      <MarketComparison evidence={data.evidence} />
      <Evidence evidence={data.evidence} />
      <DriverEvidence evidence={data.evidence} />
      <Card size="small" className="mt-4" title="AI 归因分析" extra={<Button type="primary" icon={<RobotOutlined />}
        loading={running} disabled={!data.configured || !availableAttributionTopics(data.evidence).length}
        onClick={() => void run()}>{analysis ? "重新生成" : "生成归因"}</Button>}>
        {!data.configured && <Alert type="info" showIcon title="模型服务尚未配置"
          description={<Link className="text-terminal-link" href="/agent">前往智能体对话配置模型</Link>} />}
        {running && <div className="agent-tool-status" role="status"><i />正在分析估值与股价差异…</div>}
        {analysisError && <Alert className="mt-2" type="warning" showIcon title={analysisError}
          description={analysis ? "下方仍显示上次成功生成的归因。" : undefined} />}
        {analysis && <div className="mt-2 space-y-3">
          {analysis.drivers.map(({ topic, explanation }) => <div key={topic}>
            <Typography.Text strong>{attributionTopics[topic]}</Typography.Text>
            <p className="mt-1 whitespace-pre-wrap">{explanation}</p>
          </div>)}
          <div className="border-t border-terminal-line pt-2">
            <Typography.Text strong>下一步核验</Typography.Text>
            <p className="mt-1 whitespace-pre-wrap">{analysis.check}</p>
          </div>
        </div>}
        {!analysis && data.configured && !running && !analysisError &&
          <p className="text-sm text-terminal-muted">{availableAttributionTopics(data.evidence).length ?
            "生成后将解释价格差异、关键假设及需要核验的问题。" : "现有证据不足，请先补齐估值底稿或同行、公告资料。"}</p>}
      </Card>
    </>}
  </Card>;
}
