"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Descriptions, Spin, Typography } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import Link from "next/link";
import type { ValuationAttributionEvidence } from "@/lib/valuation-attribution";

const endpoint = "/api/validation/attribution";
const percent = (value: number) => `${value.toFixed(2)}%`;
const serviceUnavailable = "分析服务暂时不可用，请稍后重试";

type EvidenceResponse = { evidence: ValuationAttributionEvidence; configured: boolean };

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
    { key: "market", label: "同日价格与差异", children: primary.upside !== null && p.comparableQuote !== null
      ? `${price(p.comparableQuote)} · ${percent(primary.upside)}`
      : p.retrospective ? "部分资料在基准日后可得，不能计算同日差异" : "缺少已核验的同日价格" },
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
  const [analysis, setAnalysis] = useState("");
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
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]),
        body: JSON.stringify({ companyId }),
      });
      if (!response.ok) throw new Error();
      const result: { evidence: ValuationAttributionEvidence; aiAttribution: string } = await response.json();
      if (!controller.signal.aborted) {
        setData({ evidence: result.evidence, configured: true });
        setAnalysis(result.aiAttribution);
      }
    } catch {
      if (!controller.signal.aborted) setAnalysisError(serviceUnavailable);
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
      <Evidence evidence={data.evidence} />
      <Card size="small" className="mt-4" title="AI 归因分析" extra={<Button type="primary" icon={<RobotOutlined />}
        loading={running} disabled={!data.configured} onClick={() => void run()}>{analysis ? "重新生成" : "生成归因"}</Button>}>
        {!data.configured && <Alert type="info" showIcon title="模型服务尚未配置"
          description={<Link className="text-terminal-link" href="/agent">前往智能体对话配置模型</Link>} />}
        {running && <div className="agent-tool-status" role="status"><i />正在分析估值驱动和证据缺口…</div>}
        {analysisError && <Alert className="mt-2" type="warning" showIcon title={analysisError}
          description={analysis ? "下方仍显示上次成功生成的归因。" : undefined} />}
        {analysis && <Typography.Paragraph className="mt-2 whitespace-pre-wrap" style={{ marginBottom: 0 }}>{analysis}</Typography.Paragraph>}
        {!analysis && data.configured && !running && !analysisError &&
          <p className="text-sm text-terminal-muted">解读估值驱动、可比性和需要补齐的证据。未对齐的行情与同行数据不用于判断上行空间。</p>}
      </Card>
    </>}
  </Card>;
}
