"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  Statistic,
  Tag,
  Table,
  Button,
  Space,
  Input,
  Modal,
  App,
  Tooltip,
} from "antd";
import {
  PlusOutlined,
  ExportOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import AppHeader from "@/components/app-header";
import { useWorkspace } from "@/app/providers";
import type { ColumnsType, ColumnType } from "antd/es/table";
import type { PrimaryValuation } from "@/lib/primary-valuation";

/** 标的类型（与 API 返回一致） */
interface Company {
  id: string;
  name: string;
  ticker: string;
  currentPrice: number;
  shares: number;
  marketCap: number;
  netCash: number;
  e0: number;
  quadrant: string;
  diagnosis: string;
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
  lastEvalDate: string | null;
}

/** 基准库档案行类型（只读对照） */
interface BaselineCompany {
  id: string;
  name: string;
  ticker: string;
  currentPrice: number;
  shares: number;
  marketCap: number;
  cash: number;
  debt: number;
  netCash: number;
  e0: number;
  revenue: number;
  bookValue: number;
  cfo: number;
  capex: number;
  da: number;
  industry: string;
  quoteUpdatedAt: string | null;
  financialUpdatedAt: string | null;
}

/** 四象限标签与配色 */
const QUADRANTS = [
  { key: "绿灯双低·容错增厚", color: "green" },
  { key: "绿灯·预期已装满", color: "green" },
  { key: "红灯·退出倍数高", color: "red" },
  { key: "红灯·预期落空", color: "red" },
];

const fmt = (n: number, d = 1) =>
  Number.isFinite(n) ? n.toFixed(d) : "-";
const fmtPct = (n: number, d = 1) =>
  Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(d)}%` : "-";

export default function DashboardPage() {
  const { preferences, savePreferences } = useWorkspace();
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [baselineCompanies, setBaselineCompanies] = useState<BaselineCompany[]>([]);
  const [baselineLoading, setBaselineLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [quadrantFilter, setQuadrantFilter] = useState<string>("");
  const [keyword, setKeyword] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const { message } = App.useApp();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/companies", { cache: "no-store" });
      const json = await res.json();
      setCompanies(json.companies ?? []);
    } catch {
      message.error("加载标的列表失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 加载基准库档案（只读对照）
  useEffect(() => {
    (async () => {
      setBaselineLoading(true);
      try {
        const res = await fetch("/api/baseline", { cache: "no-store" });
        const json = await res.json();
        setBaselineCompanies(json.companies ?? []);
      } catch {
        setBaselineCompanies([]);
      } finally {
        setBaselineLoading(false);
      }
    })();
  }, []);

  const filtered = companies.filter((c) => {
    if (quadrantFilter && c.quadrant !== quadrantFilter) return false;
    if (keyword) {
      const kw = keyword.toLowerCase();
      if (
        !c.name.toLowerCase().includes(kw) &&
        !c.ticker.toLowerCase().includes(kw)
      )
        return false;
    }
    return true;
  });

  // 顶部指标
  const total = companies.length;
  const operatingCount = companies.filter((c) => c.primaryValuation.kind === "operating").length;
  const missingCount = companies.filter((c) => c.primaryValuation.kind === "unavailable").length;

  const quadrantCounts = QUADRANTS.map((q) => ({
    ...q,
    count: companies.filter((c) => c.quadrant === q.key).length,
  }));
  const selected = filtered.find((company) => company.id === selectedId) ?? filtered[0];

  const handleDelete = async (id: string, name: string) => {
    Modal.confirm({
      title: "移除标的",
      content: `确定要移除「${name}」吗？此操作不可撤销。`,
      okText: "移除",
      okType: "danger",
      onOk: async () => {
        const res = await fetch(`/api/companies/${id}`, { method: "DELETE" });
        if (res.ok) {
          message.success(`已移除「${name}」`);
          loadData();
        } else {
          message.error("移除失败");
        }
      },
    });
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/export");
      if (!res.ok) throw new Error("Export unavailable");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dcf-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.success("导出成功");
    } catch {
      message.error("导出失败");
    }
  };

  // 表格列定义（表头与公司名列冻结，支持横向滚动）
  const columns: ColumnType<Company>[] = [
    {
      title: "标的",
      dataIndex: "name",
      fixed: "left",
      width: 120,
      render: (_, r) => (
        <div>
          <button type="button" onClick={() => setSelectedId(r.id)} aria-pressed={selected?.id === r.id}
            className="block w-full truncate text-left font-medium text-terminal-ink hover:text-terminal-link focus-visible:outline focus-visible:outline-terminal-accent" title={r.name}>
            {r.name}
          </button>
          <div className="font-mono text-[11px] text-terminal-muted">{r.ticker}</div>
        </div>
      ),
    },
    {
      title: "最新市价",
      dataIndex: "currentPrice",
      width: 82,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => (
        <span>¥{fmt(v, 2)}</span>
      ),
    },
    {
      title: "主估值",
      dataIndex: "upside",
      align: "right",
      width: 124,
      render: (_: number | null, r) => {
        const primary = r.primaryValuation;
        if (primary.kind === "unavailable") return <Tooltip title={primary.reason}><Tag color="orange">待核验</Tag></Tooltip>;
        if (primary.kind === "legacy") return <Tooltip title={primary.reason}>
          <span className="whitespace-nowrap"><span className="font-mono">¥{fmt(primary.price, 2)}</span> <span className="text-[10px] text-terminal-muted">简化参考</span></span>
        </Tooltip>;
        return <div>
          <div className="font-mono">{fmt(primary.price, 2)} {primary.publication.currency}/股</div>
          <div className="text-xs text-terminal-muted">估值基准日 {primary.publication.valuationDate}</div>
          {primary.upside !== null && <div className={primary.upside >= 0 ? "font-mono txt-pos" : "font-mono txt-neg"}>{fmtPct(primary.upside)} 同日</div>}
        </div>;
      },
    },
    {
      title: "前次评估",
      dataIndex: "originalUpside",
      width: 110,
      render: (v: number, r) => (
        <Tooltip title={`原版空间 ${fmtPct(v)}`}>
          <div className={v >= 0 ? "txt-pos" : "txt-neg"}>{fmtPct(v)}</div>
          {r.lastEvalDate && (
            <div className="text-xs text-terminal-muted">
              {new Date(r.lastEvalDate).toLocaleDateString()}
            </div>
          )}
        </Tooltip>
      ),
    },
    {
      title: "正向终局现金流（第20年）",
      dataIndex: "terminalProfitY20",
      width: 130,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)} 亿</span>,
    },
    {
      title: "终局FCF/E3",
      dataIndex: "terminalFcfE3",
      width: 100,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 2)}x</span>,
    },
    {
      title: "隐含终局现金流 L",
      dataIndex: "impliedL",
      width: 124,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span className="txt-mid">{fmt(v, 1)} 亿</span>,
    },
    {
      title: "隐含现金流 / E3",
      dataIndex: "impliedLE3",
      width: 110,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => (
        <span className={v >= 0 ? "txt-neg" : "txt-pos"}>{fmt(v, 2)}x</span>
      ),
    },
    {
      title: "17 年折算值",
      dataIndex: "impliedCagr",
      width: 130,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)}%</span>,
    },
    {
      title: "终局利润估计",
      dataIndex: "terminalProfitEst",
      width: 120,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)} 亿</span>,
    },
    {
      title: "过渡期年化g",
      dataIndex: "transitionG",
      width: 110,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v * 100, 2)}%</span>,
    },
    {
      title: "WACC",
      dataIndex: "wacc",
      width: 80,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v * 100, 2)}%</span>,
    },
    {
      title: "叙事分级诊断",
      dataIndex: "diagnosis",
      width: 132,
      render: (v: string) => (
        <Tag color={v.includes("现金") ? "green" : v.includes("高") ? "red" : "blue"}>
          {v || "-"}
        </Tag>
      ),
    },
    {
      title: "当前市值(亿)",
      dataIndex: "marketCap",
      width: 110,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "操作",
      key: "action",
      fixed: "right",
      width: 150,
      render: (_, r) => (
        <Space size={2} wrap={false} style={{ whiteSpace: "nowrap" }}>
          <Button
            size="small"
            type="link"
            onClick={() => router.push("/company/" + encodeURIComponent(r.ticker))}
          >
            详情
          </Button>
          <Button
            size="small"
            type="link"
            onClick={() => router.push("/model/edit?id=" + encodeURIComponent(r.id))}
          >
            改假设
          </Button>
          <Button
            size="small"
            type="link"
            danger
            onClick={() => handleDelete(r.id, r.name)}
          >
            移除
          </Button>
        </Space>
      ),
    },
  ];

  // 基准库档案对照表列（只读参考）
  const baselineColumns: ColumnType<BaselineCompany>[] = [
    {
      title: "标的",
      dataIndex: "name",
      fixed: "left",
      width: 150,
      render: (_, r) => (
        <div>
          <div className="font-medium text-terminal-ink">{r.name}</div>
          <div className="font-mono text-[11px] text-terminal-muted">{r.ticker}</div>
        </div>
      ),
    },
    {
      title: "最新市价",
      dataIndex: "currentPrice",
      width: 90,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>¥{fmt(v, 2)}</span>,
    },
    {
      title: "总股本(亿股)",
      dataIndex: "shares",
      width: 100,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 2)}</span>,
    },
    {
      title: "市值(亿)",
      dataIndex: "marketCap",
      width: 100,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "货币资金(亿)",
      dataIndex: "cash",
      width: 100,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "有息负债(亿)",
      dataIndex: "debt",
      width: 100,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "净现金(亿)",
      dataIndex: "netCash",
      width: 100,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => (
        <span className={v >= 0 ? "txt-pos" : "txt-neg"}>{fmt(v, 1)}</span>
      ),
    },
    {
      title: "E0净利(亿)",
      dataIndex: "e0",
      width: 90,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "营收S0(亿)",
      dataIndex: "revenue",
      width: 100,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "净资产B0(亿)",
      dataIndex: "bookValue",
      width: 100,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "CFO(亿)",
      dataIndex: "cfo",
      width: 90,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "Capex(亿)",
      dataIndex: "capex",
      width: 90,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "D&A(亿)",
      dataIndex: "da",
      width: 90,
      className: "font-mono-num",
      align: "right",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "行业",
      dataIndex: "industry",
      width: 110,
      render: (v: string) => v || "-",
    },
  ];

  return (
    <div className="valuation-dashboard min-h-screen bg-terminal-canvas text-terminal-ink">
      {/* 看板操作 */}
      <AppHeader
        title="DCF 估值穿透与弹性空间测算终端"
        subtitle="正向 20 年 DCF 内在价值 + 逆向终局现金流 L 反算 · 安全：服务端二次校验"
        actions={
          <Space wrap size={6}>
            <Button icon={<ReloadOutlined />} onClick={loadData}>
              刷新
            </Button>
            <Button icon={<ExportOutlined />} onClick={handleExport}>
              导出 JSON
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => router.push("/valuation/new")}
            >
              新增估值标的
            </Button>
          </Space>
        }
      />

      <div className="terminal-page grid gap-2">
        <section aria-label="估值概况" className="market-strip grid grid-cols-3 overflow-hidden rounded-md border border-terminal-line bg-terminal-surface">
          <Statistic title="监控标的" value={total} />
          <Statistic title="已发布经营估值" value={operatingCount} suffix={"/ " + total} />
          <Statistic title="待核验" value={missingCount} />
        </section>

        <div className="grid min-w-0 items-start gap-2 xl:grid-cols-[minmax(0,1fr)_264px]">
        <div className="grid min-w-0 gap-2">
        <Card size="small" className="terminal-watchlist min-w-0" title="估值监控列表"
          extra={
            <Input
              prefix={<SearchOutlined />}
              aria-label="搜索代码或标的简称"
              placeholder="搜索代码或标的简称"
              size="small"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full max-w-[13rem]"
              allowClear
            />
          }
        >
          <Table
            rowKey="id"
            columns={columns.filter(col=> !col.dataIndex || ["name","currentPrice","upside","impliedL","diagnosis"].includes(String(col.dataIndex)))}
            expandable={{expandedRowRender:r=><div className="detail-grid">{columns.filter(col=>col.dataIndex).map(col=><div key={String(col.dataIndex)}><span>{String(col.title)}</span><strong>{String(r[col.dataIndex as keyof Company]??"—")}</strong></div>)}</div>}}
            dataSource={filtered}
            rowClassName={(company) => company.id === selected?.id ? "watchlist-selected" : ""}
            loading={loading}
            scroll={{ x: 680, y: 420 }}
            size="small"
            className={preferences.boardDensity === "compact" ? "fin-table dashboard-primary-table" : "fin-table"}
            pagination={{ pageSize: preferences.boardPageSize, showSizeChanger: true,
              pageSizeOptions: [10, 20, 50], onChange: (_, size) => {
                if ((size === 10 || size === 20 || size === 50) && size !== preferences.boardPageSize)
                  savePreferences({ ...preferences, boardPageSize: size });
              } }}
          />
        </Card>

        <Card size="small" title="基准库档案" extra={<span className="text-xs text-terminal-muted">只读参考</span>}>
          <Table
            rowKey="id"
            columns={baselineColumns.filter(col=>!col.dataIndex || ["name","ticker","currentPrice","e0","revenue"].includes(String(col.dataIndex)))}
            dataSource={baselineCompanies}
            loading={baselineLoading}
            scroll={{ x: 460, y: 320 }}
            size="small"
            className="fin-table"
            pagination={false}
          />
        </Card>
        </div>
        <aside aria-label="标的监控面板" className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-1">
        <Card size="small" title="标的快照" className="min-w-0">
          {selected ? <>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/company/${encodeURIComponent(selected.ticker)}`} className="font-semibold text-terminal-link hover:underline">{selected.name}</Link>
              <span className="font-mono text-xs text-terminal-muted">{selected.ticker}</span>
            </div>
            <dl className="snapshot-grid">
              <dt>档案行情</dt><dd>{fmt(selected.currentPrice, 2)} {/\.HK$/i.test(selected.ticker) ? "HKD" : /\.(SH|SZ|BJ)$/i.test(selected.ticker) ? "CNY" : "当地币"}/股</dd>
              <dt>主估值</dt><dd>{selected.primaryValuation.kind === "unavailable" ? "待核验" : `${fmt(selected.primaryValuation.price, 2)} ${selected.primaryValuation.kind === "operating" ? selected.primaryValuation.publication.currency : "元"}/股`}</dd>
              <dt>同日潜在空间</dt><dd className={selected.upside === null || selected.upside === 0 ? undefined : selected.upside > 0 ? "txt-pos" : "txt-neg"}>{selected.upside === null ? "—" : fmtPct(selected.upside)}</dd>
              <dt>市值</dt><dd>{fmt(selected.marketCap)} 亿</dd>
              <dt>净现金</dt><dd>{fmt(selected.netCash)} 亿</dd>
              <dt>估值日期</dt><dd>{selected.primaryValuation.kind === "operating" ? selected.primaryValuation.publication.valuationDate : "—"}</dd>
              {selected.primaryValuation.kind === "operating" && <>
                <dt>资料截止</dt><dd>{selected.primaryValuation.publication.informationCutoff}</dd>
                <dt>数据状态</dt><dd>{selected.primaryValuation.publication.retrospective ? "无同日可比估值"
                  : selected.primaryValuation.publication.comparableQuote === null ? "同日行情待核验" : "同日可比"}</dd>
              </>}
            </dl>
          </> : <span className="text-xs text-terminal-muted">没有符合条件的标的</span>}
        </Card>
        <Card size="small" title="估值诊断" className="min-w-0">
          <div aria-label="估值诊断筛选" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-1">
            {quadrantCounts.map((quadrant) => (
              <button key={quadrant.key} type="button"
                aria-pressed={quadrantFilter === quadrant.key}
                onClick={() => setQuadrantFilter(quadrantFilter === quadrant.key ? "" : quadrant.key)}
                className="flex min-w-0 items-center gap-2 rounded-md border border-terminal-line px-2.5 py-2 text-left text-xs text-terminal-muted hover:bg-terminal-hover hover:text-terminal-ink focus-visible:outline focus-visible:outline-terminal-accent-hover aria-pressed:border-terminal-accent-hover aria-pressed:bg-terminal-hover aria-pressed:text-terminal-ink">
                <span aria-hidden="true" className={quadrant.color === "green" ? "size-1.5 shrink-0 rounded-full bg-terminal-positive" : "size-1.5 shrink-0 rounded-full bg-terminal-negative"} />
                <span className="flex-1">{quadrant.key}</span>
                <span className="font-mono text-terminal-ink">{quadrant.count}</span>
              </button>
            ))}
          </div>
        </Card>
        </aside>
        </div>

      </div>

    </div>
  );
}
