"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Input, Select, Table, Tag } from "antd";
import type { IndustrySnapshotView } from "@/lib/industry-snapshot";

type Group = { industry: string; candidates: number };
const endpoint = "/api/settings/industry-multiples";
const display = (n: number | null | undefined) => n == null ? "—" : n.toFixed(2);
const provider = (name: string) => name === "ifind" ? "同花顺 iFinD" : "东方财富";
const names = ["P/E", "P/B", "P/S", "EV/Revenue", "EV/EBITDA", "EV/EBIT"];

export default function IndustryMultiplesPanel() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [industry, setIndustry] = useState("");
  const [date, setDate] = useState("");
  const [snapshot, setSnapshot] = useState<IndustrySnapshotView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const control = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: control.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { groups: Group[] };
        setGroups(data.groups);
        setIndustry(data.groups[0]?.industry ?? "");
      }).catch(() => { if (!control.signal.aborted) setError("读取行业目录失败"); });
    return () => control.abort();
  }, []);

  useEffect(() => {
    if (!industry) return;
    const control = new AbortController();
    const filters = new URLSearchParams({ industry });
    if (date) filters.set("date", date);
    setSnapshot(null);
    setError("");
    setMessage("");
    setBusy(true);
    fetch(`${endpoint}?${filters}`, { cache: "no-store", signal: control.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!control.signal.aborted) setSnapshot(data.snapshot);
      }).catch(() => { if (!control.signal.aborted) setError("查询行业快照失败"); })
      .finally(() => { if (!control.signal.aborted) setBusy(false); });
    return () => control.abort();
  }, [industry, date]);

  async function refresh() {
    if (busy || !industry) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry }), signal: AbortSignal.timeout(65000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "更新行业资料失败");
      setSnapshot(data.snapshot);
      setMessage(data.mode === "fallback" ? "未取得新的同口径资料，显示最近可用快照。" : "行业快照已保存。");
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "数据源响应超时，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return <Card size="small" title="行业估值倍数资料库">
    <p className="mb-3 text-sm text-terminal-muted">
      A 股同日未复权收盘价与同一年度财报。市值按收盘价乘年报总股本估算，A/H 两地上市公司的市值为 A 股价格口径近似。相对估值剔除标的自身，每项至少需要三家有效同行。
    </p>
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs">行业
        <Select aria-label="行业" className="min-w-36" showSearch optionFilterProp="label" disabled={busy}
          value={industry || undefined} options={groups.map((group) => ({
            value: group.industry, label: `${group.industry}（${group.candidates} 家候选）`,
          }))} onChange={(value) => { setIndustry(value); setDate(""); }} />
      </label>
      <label className="flex flex-col gap-1 text-xs">历史快照日期
        <Input type="date" aria-label="历史快照日期" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} />
      </label>
      <Button disabled={busy || !date} onClick={() => setDate("")}>查看最新</Button>
      <Button type="primary" loading={busy} disabled={!industry || !!date} onClick={() => void refresh()}>更新行业资料</Button>
      {snapshot && <Button href={`${endpoint}?${new URLSearchParams({ industry: snapshot.industry, date: snapshot.date, download: "1" })}`}>
        下载快照
      </Button>}
    </div>
    {error && <Alert type="error" showIcon title={error} className="mb-3" />}
    {message && <p role="status" className="mb-3 text-sm">{message}</p>}
    {snapshot ? <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Tag>收盘 {snapshot.date}</Tag><Tag>年报 {snapshot.period}</Tag><Tag>人民币 · {snapshot.samples.length} 家入库</Tag>
      </div>
      <Table rowKey="name" size="small" pagination={false} dataSource={snapshot.methods} columns={[
        { title: "倍数", dataIndex: "name" },
        { title: "有效家数", dataIndex: "count", align: "right" },
        { title: "中位数", dataIndex: "median", align: "right", render: display },
        { title: "均值", dataIndex: "mean", align: "right", render: display },
      ]} />
      <Table className="mt-4" rowKey="ticker" size="small" scroll={{ x: 750 }} pagination={false} dataSource={snapshot.samples} columns={[
        { title: "样本", render: (_, row) => `${row.name} ${row.ticker}` },
        ...names.map((name) => ({ title: name, key: name, align: "right" as const,
          render: (_: unknown, row: IndustrySnapshotView["samples"][number]) => display(row.multiples[name]) })),
        { title: "财报 / 行情", render: (_, row) => <span title={row.supplementalSource ?? undefined}>
          {provider(row.financialSource)} / {provider(row.quoteSource)}
          {row.equitySource && row.equitySource !== row.financialSource && ` · 净资产 ${provider(row.equitySource)}`}
        </span> },
      ]} />
      {snapshot.excluded.length > 0 && <p className="mt-3 text-xs text-terminal-muted">
        未入库：{snapshot.excluded.map((item) => `${item.name}（${item.excluded}）`).join("、")}
      </p>}
      <p className="mt-3 text-xs text-terminal-muted">EV 为市值扣减可核验净现金的简化口径。年报 EBIT 按利润总额加费用化利息计算。金融业停用 EV 倍数，缺失字段及非正分母对应的倍数留空。</p>
    </> : !busy && <Empty description={date ? "该日期暂无留存快照" : "暂无快照，可更新当前行业资料"} />}
  </Card>;
}
