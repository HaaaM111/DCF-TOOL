"use client";

import { useId, useState } from "react";
import { Alert, Button, Card, Collapse, Descriptions, Input, Segmented, Space, Table, Typography } from "antd";
import { SensitivityHeatmap } from "./validation-charts";
import type { OperatingAnalysis, OperatingAnalysisInput } from "@/lib/operating-scenarios";

const { Paragraph, Text } = Typography;
const maxInputLength = 32000;
const money = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 2 });
const units = { ones: ["元", "股"], millions: ["百万元", "百万股"], hundredMillions: ["亿元", "亿股"] };

function ValuationResult({ result }: { result: OperatingAnalysis }) {
  const { input, prices, bridge, terminal, reconciliation } = result;
  const [method, setMethod] = useState<"coherentPrice" | "workbookPrice">("coherentPrice");
  const [amountUnit, shareUnit] = units[input.scale];
  const amount = (v: number) => money.format(v);
  const price = (v: number) => `${amount(v)} ${input.currency}/股`;
  const benchmarkDifference = result.benchmarkDifference;
  return (
    <Space orientation="vertical" size="middle" className="w-full" aria-live="polite">
      <Alert
        type={reconciliation.passed ? "success" : "error"}
        title={reconciliation.passed ? "三模型公式勾稽通过" : "三模型公式勾稽失败"}
        description={`最大差额 ${reconciliation.maximumGap.toExponential(2)} ${input.currency}/股。勾稽检验采用同一组预测和终值假设。`}
        showIcon
      />
      {result.retrospective && <Alert type="warning" showIcon title="使用了估值锚点之后可得的资料" description="结果适用于事后复算。历史时点评估需要冻结在估值锚点当日已可得的资料。" />}
      {input.quote && !result.marketComparable && <Alert type="warning" showIcon
        title="市价比较与隐含增长率已停用"
        description={`报价日 ${input.quote.date}。市价校验需要同日价格，并使用估值锚点当日已可得的资料。`}
      />}
      {bridge.equityValue <= 0 && <Alert type="warning" showIcon title="模型股权价值为非正值，请复核持续经营假设和权益桥接" />}
      <Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 3 }} items={[
        { key: "fcff", label: "FCFF 折现", children: price(prices.fcff) },
        { key: "reoi", label: "剩余经营收益", children: price(prices.reoi) },
        { key: "aoig", label: "异常经营收益增长", children: price(prices.aoig) },
        { key: "valuation", label: "年末折现锚点", children: result.valuationDate },
        { key: "cutoff", label: "资料截止日", children: input.informationCutoff },
        { key: "rates", label: "WACC / 永续 g", children: `${pct.format(input.wacc)} / ${pct.format(input.terminalGrowth)}` },
        { key: "opening", label: "基期来源", children: `${input.openingSource.name} · ${input.openingSource.availableOn}` },
        { key: "forecast", label: "预测来源", children: `${input.forecastSource.name} · ${input.forecastSource.availableOn}` },
        { key: "terminal", label: "终值占经营价值", children: terminal.operatingValueShare === null ? "—" : pct.format(terminal.operatingValueShare) },
      ]} />
      <Paragraph className="break-words" style={{ marginBottom: 0 }}>
        经营价值 {amount(bridge.operatingValue)} − 净金融负债（{amount(bridge.netFinancialObligations)}）
        {" "}− 少数股东权益 {amount(bridge.minorityInterest)} = 归母股权价值 {amount(bridge.equityValue)}
        {" "}{input.currency} {amountUnit}。总股数 {amount(input.shares)} {shareUnit}。
      </Paragraph>
      {input.benchmarkPrice !== undefined && benchmarkDifference !== null && <Text>
        导入的参考值 {price(input.benchmarkPrice)}，ReOI 差额 {price(benchmarkDifference)}。
      </Text>}
      {result.crossValidationRange && <Text>
        ReOI 与模板经营倍数估值区间 {price(result.crossValidationRange.low)} 至 {price(result.crossValidationRange.high)}。
      </Text>}
      {input.quote && result.marketComparable && <Text>
        同日市价 {price(input.quote.price)}（{input.quote.source}），完整显性期模型隐含 g
        {" "}{result.impliedGrowth === null ? "无有效解" : pct.format(result.impliedGrowth)}。
      </Text>}
      <Collapse items={[{
        key: "cash-flow",
        label: `年度经营预测和终值（${input.currency} ${amountUnit}）`,
        children: <>
          <Table size="small" rowKey="year" pagination={false} scroll={{ x: 625 }} dataSource={result.rows} columns={[
            { title: "年度", dataIndex: "year" },
            { title: "税后经营利润", dataIndex: "income", align: "right", render: amount },
            { title: "期末 NOA", dataIndex: "closingNoa", align: "right", render: amount },
            { title: "净再投资", dataIndex: "reinvestment", align: "right", render: amount },
            { title: "FCFF", dataIndex: "fcff", align: "right", render: amount },
            { title: "ReOI", dataIndex: "reoi", align: "right", render: amount },
            { title: "AOIG", dataIndex: "aoig", align: "right", render: (v: number | null) => v === null ? "—" : amount(v) },
          ]} />
          <Text type="secondary">
            {terminal.year}E 永续期首年 FCFF {amount(terminal.fcff)}，ReOI {amount(terminal.reoi)}，
            经营终值现值 {amount(terminal.pvOperatingTerminal)}。
          </Text>
        </>,
      }, {
        key: "sensitivity",
        label: "WACC × 永续增长率热力图",
        children: <>
          <Segmented value={method} onChange={setMethod} options={[
            { label: "经营口径", value: "coherentPrice" },
            { label: "Excel 复算", value: "workbookPrice" },
          ]} />
          <Paragraph type="secondary">
            {method === "coherentPrice" ? "每格按情景 WACC 重算资本费用和现值。" : "沿用基准 ReOI，每格更换折现率与永续增长率。"}
            {" "}空白表示参数组合超出模型范围。
          </Paragraph>
          <SensitivityHeatmap rateLabel="WACC" currency={input.currency} matrix={result.heatmap.map((cell) => ({
            wacc: cell.wacc, g: cell.g, targetPrice: cell[method],
          }))} />
        </>,
      }, ...(result.simulation ? [{
        key: "simulation",
        label: "经营估值蒙特卡洛",
        children: <>
          <Paragraph type="secondary">
            请求 {result.simulation.config.samples} 次，种子 {result.simulation.config.seed}，
            永续增长率触发上限 {result.simulation.capped} 次，剔除 {result.simulation.rejected} 次。
            Excel 复算沿用基准资本费用。经营口径按情景重算资本费用，配置项目冲击时同时调整净经营资产。
          </Paragraph>
          <Table size="small" rowKey="name" pagination={false} scroll={{ x: 450 }} dataSource={[
            { name: "Excel 复算", stats: result.simulation.workbook },
            { name: "经营口径", stats: result.simulation.coherent },
          ]} columns={[
            { title: "口径", dataIndex: "name" },
            ...(["p5", "median", "p95", "mean"] as const).map((key) => ({
              title: { p5: "P5", median: "P50", p95: "P95", mean: "均值" }[key],
              key, align: "right" as const,
              render: (_: unknown, row: { stats: NonNullable<OperatingAnalysis["simulation"]>["workbook"] }) =>
                row.stats ? price(row.stats[key]) : "有效样本不足",
            })),
          ]} />
        </>,
      }] : []), ...(result.peerValuation ? [{
        key: "operating-peers",
        label: "模板经营倍数交叉验证",
        children: <>
          <Paragraph type="secondary">
            {result.peerValuation.source} · 市值日期 {result.peerValuation.quoteDate} ·
            资料可得日 {result.peerValuation.availableOn} · 中位数折价 {pct.format(result.peerValuation.adjustment)}。
            {result.peerValuation.retrospective && " 使用估值锚点后可得资料。"}
          </Paragraph>
          <Paragraph>{result.peerValuation.peers.map((p) => `${p.name}（${p.ticker}，${p.reason}）`).join("；")}</Paragraph>
          <Table size="small" rowKey="name" pagination={false} scroll={{ x: 470 }} dataSource={result.peerValuation.methods} columns={[
            { title: "经营倍数", dataIndex: "name" },
            { title: "有效同行", dataIndex: "count", align: "right" },
            { title: "中位数", dataIndex: "median", align: "right", render: (v: number | null) => v === null ? "—" : amount(v) },
            { title: "每股价值", dataIndex: "price", align: "right", render: (v: number | null) => v === null ? "数据不足" : price(v) },
          ]} />
        </>,
      }] : [])]} />
    </Space>
  );
}

export default function OperatingValuationPanel({ ticker }: { ticker: string }) {
  const fileId = useId();
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<OperatingAnalysis | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function edit(next: string) {
    setDraft(next);
    setResult(null);
    setError("");
  }

  function fillExample() {
    const source = { name: "虚拟示例", availableOn: "2025-12-31" };
    const example: OperatingAnalysisInput = {
      ticker: ticker.toUpperCase(), baseYear: 2025, informationCutoff: "2025-12-31", currency: "CNY", scale: "millions",
      openingSource: source, forecastSource: source, openingNoa: 1000, netFinancialObligations: -30,
      minorityInterest: 12, shares: 100, wacc: 0.095, terminalGrowth: 0.028,
      forecast: [
        { year: 2026, afterTaxOperatingIncome: 116, closingNoa: 1040 },
        { year: 2027, afterTaxOperatingIncome: 123, closingNoa: 1090 },
      ],
      scenarios: { simulation: { samples: 10000, seed: 42, waccStd: 0.01, growthStd: 0.006, minimumSpread: 0.01 } },
    };
    edit(JSON.stringify(example, null, 2));
  }

  async function calculate() {
    setResult(null);
    setError("");
    let parsed: { ticker?: string } | null;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setError("输入需要是有效的 JSON");
      return;
    }
    if (parsed?.ticker !== ticker.toUpperCase()) {
      setError(`输入中的 ticker 须与当前公司 ${ticker} 一致`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/dcf/operating-validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: draft,
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "估值校验请求失败");
      setResult(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "估值校验请求失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="经营价值勾稽 · FCFF / ReOI / AOIG" className="mb-4">
      <Space orientation="vertical" size="middle" className="w-full">
        <Text type="secondary">使用年度税后经营利润和期末净经营资产（NOA）复算。金额与股数使用同一数量级，9.5% 填 0.095。计算结果仅用于本次校验。</Text>
        <Collapse items={[{
          key: "input",
          label: "录入经营预测或导入 JSON",
          children: <Space orientation="vertical" className="w-full">
            <Space wrap>
              <Button onClick={fillExample} disabled={loading}>填入虚拟示例</Button>
              <label htmlFor={fileId}>导入校验文件</label>
              <input id={fileId} type="file" accept=".json,application/json" disabled={loading}
                className="max-w-full text-sm"
                onChange={async (event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (!file) return;
                  if (file.size > maxInputLength) {
                    setError("校验文件须小于 32 KB");
                    return;
                  }
                  try {
                    edit(await file.text());
                  } catch {
                    setError("无法读取校验文件");
                  }
                }}
              />
            </Space>
            <Input.TextArea aria-label="经营价值校验 JSON" value={draft} disabled={loading} maxLength={maxInputLength}
              rows={9} className="font-mono" placeholder="填入示例查看字段，或导入已有校验文件"
              onChange={(event) => edit(event.target.value)}
            />
            <Button type="primary" onClick={calculate} loading={loading} disabled={!draft.trim()}>复算并校验</Button>
          </Space>,
        }]} />
        {error && <Alert type="error" title={error} showIcon />}
        {result && <ValuationResult result={result} />}
      </Space>
    </Card>
  );
}
