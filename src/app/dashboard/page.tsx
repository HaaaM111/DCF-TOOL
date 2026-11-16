"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Button,
  Dropdown,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Upload,
  Alert,
} from "antd";
import {
  DownOutlined,
  ExportOutlined,
  ImportOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/app-header";
import {
  PriceTargetChart,
  UpsideComparison,
} from "@/components/research-charts";
import type { QuadrantCompany } from "@/components/research-charts";
import type { ColumnsType } from "antd/es/table";

interface Company extends QuadrantCompany {
  shares: number;
  marketCap: number;
  netCash: number;
  e0: number;
  diagnosis: string;
  originalUpside: number;
  impliedKe: number;
  forwardKe: number;
  wacc: number;
  terminalProfitY20: number;
  terminalFcfE3: number;
  impliedL: number;
  impliedLE3: number;
  terminalProfitEst: number;
  transitionG: number;
  quoteUpdatedAt: string | null;
  lastEvalDate: string | null;
}

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

interface PricePoint {
  date: string;
  close: number;
}

interface ValuationPoint {
  date: string;
  targetPrice: number;
}

const QUADRANTS = [
  { key: "绿灯双低·容错增厚", label: "双低" },
  { key: "绿灯·预期已装满", label: "预期满" },
  { key: "红灯·退出倍数高", label: "倍数高" },
  { key: "红灯·预期落空", label: "落空" },
];

const fmt = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : "-";
const fmtPct = (value: number, digits = 1) =>
  Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
    : "-";

function latestDate(values: (string | null)[]) {
  const valid = values.filter((value): value is string => Boolean(value)).sort();
  const latest = valid.at(-1);
  if (!latest) return "暂无记录";
  const date = new Date(latest);
  if (Number.isNaN(date.getTime())) return "暂无记录";
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

export default function DashboardPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [baselineCompanies, setBaselineCompanies] = useState<BaselineCompany[]>([]);
  const [baselineLoading, setBaselineLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [quadrantFilter, setQuadrantFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [valuation, setValuation] = useState<ValuationPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState("");
  const companyRequest = useRef(0);
  const priceRequest = useRef(0);
  const { message } = App.useApp();

  const loadData = useCallback(async () => {
    const requestId = ++companyRequest.current;
    setLoading(true);
    try {
      const res = await fetch("/api/companies", { cache: "no-store" });
      if (!res.ok) throw new Error("加载标的列表失败");
      const json = (await res.json()) as { companies?: Company[] };
      if (requestId !== companyRequest.current) return;
      const list = json.companies ?? [];
      setCompanies(list);
      setSelectedId((current) =>
        current && list.some((company) => company.id === current)
          ? current
          : list[0]?.id ?? "",
      );
    } catch {
      if (requestId === companyRequest.current) message.error("加载标的列表失败");
    } finally {
      if (requestId === companyRequest.current) setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    loadData();
    return () => {
      companyRequest.current += 1;
      priceRequest.current += 1;
    };
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBaselineLoading(true);
      try {
        const res = await fetch("/api/baseline", { cache: "no-store" });
        const json = (await res.json()) as { companies?: BaselineCompany[] };
        if (!cancelled) setBaselineCompanies(json.companies ?? []);
      } catch {
        if (!cancelled) setBaselineCompanies([]);
      } finally {
        if (!cancelled) setBaselineLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSelectedPrices = useCallback(async () => {
    if (!selectedId) {
      setPrices([]);
      setValuation([]);
      setChartError("");
      return;
    }
    const requestId = ++priceRequest.current;
    setChartLoading(true);
    setChartError("");
    try {
      const res = await fetch(`/api/companies/${selectedId}/prices`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("历史行情暂时不可用");
      const json = (await res.json()) as {
        prices?: PricePoint[];
        valuation?: ValuationPoint[];
      };
      if (requestId !== priceRequest.current) return;
      setPrices(json.prices ?? []);
      setValuation(json.valuation ?? []);
    } catch (error) {
      if (requestId !== priceRequest.current) return;
      setPrices([]);
      setValuation([]);
      setChartError(error instanceof Error ? error.message : "历史行情暂时不可用");
    } finally {
      if (requestId === priceRequest.current) setChartLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadSelectedPrices();
    return () => {
      priceRequest.current += 1;
    };
  }, [loadSelectedPrices]);

  const handleRefresh = useCallback(() => {
    void loadData();
    void loadSelectedPrices();
  }, [loadData, loadSelectedPrices]);

  const filtered = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return companies.filter((company) => {
      if (quadrantFilter && company.quadrant !== quadrantFilter) return false;
      if (
        normalized &&
        !company.name.toLowerCase().includes(normalized) &&
        !company.ticker.toLowerCase().includes(normalized)
      ) {
        return false;
      }
      return true;
    });
  }, [companies, quadrantFilter, keyword]);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedId) ?? companies[0],
    [companies, selectedId],
  );
  const averageUpside = useMemo(
    () =>
      companies.length
        ? companies.reduce((sum, company) => sum + company.upside, 0) / companies.length
        : 0,
    [companies],
  );
  const positiveCount = useMemo(
    () => companies.filter((company) => company.upside > 0).length,
    [companies],
  );
  const quadrantOptions = useMemo(
    () => [
      { value: "all", label: `全部象限 ${companies.length}` },
      ...QUADRANTS.map((quadrant) => ({
        value: quadrant.key,
        label: `${quadrant.label} ${companies.filter((company) => company.quadrant === quadrant.key).length}`,
      })),
    ],
    [companies],
  );

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      Modal.confirm({
        title: "移除标的",
        content: `确定要移除「${name}」吗？此操作不可撤销。`,
        okText: "移除",
        okType: "danger",
        onOk: async () => {
          const res = await fetch(`/api/companies/${id}`, { method: "DELETE" });
          if (res.ok) {
            message.success(`已移除「${name}」`);
            await loadData();
          } else {
            message.error("移除失败");
          }
        },
      });
    },
    [message, loadData],
  );

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const res = await fetch("/api/import", {
          method: "POST",
          body: file,
          headers: { "Content-Type": "application/json" },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          message.error(json.error ?? "导入失败");
          return false;
        }
        message.success(`导入完成：新增 ${json.created} 条，跳过 ${json.skipped} 条`);
        setImportModalOpen(false);
        await loadData();
      } catch {
        message.error("导入失败，请检查网络与文件格式");
      }
      return false;
    },
    [message, loadData],
  );

  const handleExport = useCallback(async () => {
    try {
      const res = await fetch("/api/export");
      if (!res.ok) throw new Error("导出失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `dcf-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      message.success("导出成功");
    } catch {
      message.error("导出失败");
    }
  }, [message]);

  const columns = useMemo<ColumnsType<Company>>(
    () => [
      {
        title: "标的简称",
        dataIndex: "name",
        fixed: "left",
        width: 140,
        render: (_, record) => (
          <div>
            <div className="font-semibold text-ink">{record.name}</div>
            <div className="text-xs text-muted">{record.ticker}</div>
          </div>
        ),
      },
      {
        title: "最新市价",
        dataIndex: "currentPrice",
        width: 100,
        className: "font-mono-num",
        render: (value: number) => `¥${fmt(value, 2)}`,
      },
      {
        title: "调整后潜在空间",
        dataIndex: "upside",
        width: 140,
        render: (value: number, record) => (
          <div>
            <div className={value >= 0 ? "txt-pos" : "txt-neg"}>{fmtPct(value)}</div>
            <div className="text-xs text-muted">目标 ¥{fmt(record.targetPrice, 2)}</div>
          </div>
        ),
      },
      {
        title: "原版空间",
        dataIndex: "originalUpside",
        width: 105,
        render: (value: number) => (
          <span className={value >= 0 ? "txt-pos" : "txt-neg"}>{fmtPct(value)}</span>
        ),
      },
      {
        title: "隐含 CAGR",
        dataIndex: "impliedCagr",
        width: 115,
        className: "font-mono-num",
        render: (value: number) => `${fmt(value)}%`,
      },
      {
        title: "L / E3",
        dataIndex: "impliedLE3",
        width: 100,
        className: "font-mono-num",
        render: (value: number) => (
          <span className={value >= 30 ? "txt-neg" : "txt-pos"}>{fmt(value, 2)}x</span>
        ),
      },
      {
        title: "过渡期年化 g",
        dataIndex: "transitionG",
        width: 125,
        className: "font-mono-num",
        render: (value: number) => `${fmt(value * 100, 2)}%`,
      },
      {
        title: "WACC",
        dataIndex: "wacc",
        width: 95,
        className: "font-mono-num",
        render: (value: number) => `${fmt(value * 100, 2)}%`,
      },
      {
        title: "叙事分级诊断",
        dataIndex: "diagnosis",
        width: 160,
        render: (value: string) => (
          <Tag color={value.includes("现金") ? "green" : value.includes("高") ? "red" : "blue"}>
            {value || "-"}
          </Tag>
        ),
      },
      {
        title: "当前市值（亿）",
        dataIndex: "marketCap",
        width: 125,
        className: "font-mono-num",
        render: (value: number) => fmt(value),
      },
      {
        title: "操作",
        key: "action",
        fixed: "right",
        width: 190,
        render: (_, record) => (
          <Space size={4} wrap={false} style={{ whiteSpace: "nowrap" }}>
            <Button
              size="small"
              type="link"
              onClick={(event) => {
                event.stopPropagation();
                router.push(`/report/${record.id}`);
              }}
            >
              详情
            </Button>
            <Button
              size="small"
              type="link"
              onClick={(event) => {
                event.stopPropagation();
                router.push(`/model/edit?id=${record.id}`);
              }}
            >
              改假设
            </Button>
            <Button
              size="small"
              type="link"
              danger
              onClick={(event) => {
                event.stopPropagation();
                void handleDelete(record.id, record.name);
              }}
            >
              移除
            </Button>
          </Space>
        ),
      },
    ],
    [router, handleDelete],
  );

  const baselineColumns = useMemo<ColumnsType<BaselineCompany>>(
    () => [
      {
        title: "标的",
        dataIndex: "name",
        fixed: "left",
        width: 150,
        render: (_, record) => (
          <div>
            <div className="font-semibold text-ink">{record.name}</div>
            <div className="text-xs text-muted">{record.ticker}</div>
          </div>
        ),
      },
      { title: "最新市价", dataIndex: "currentPrice", width: 95, render: (v: number) => `¥${fmt(v, 2)}` },
      { title: "总股本（亿股）", dataIndex: "shares", width: 120, render: (v: number) => fmt(v, 2) },
      { title: "市值（亿）", dataIndex: "marketCap", width: 105, render: (v: number) => fmt(v) },
      { title: "货币资金（亿）", dataIndex: "cash", width: 120, render: (v: number) => fmt(v) },
      { title: "有息负债（亿）", dataIndex: "debt", width: 120, render: (v: number) => fmt(v) },
      { title: "净现金（亿）", dataIndex: "netCash", width: 115, render: (v: number) => fmt(v) },
      { title: "E0 净利（亿）", dataIndex: "e0", width: 115, render: (v: number) => fmt(v) },
      { title: "营收 S0（亿）", dataIndex: "revenue", width: 120, render: (v: number) => fmt(v) },
      { title: "净资产 B0（亿）", dataIndex: "bookValue", width: 130, render: (v: number) => fmt(v) },
      { title: "CFO（亿）", dataIndex: "cfo", width: 105, render: (v: number) => fmt(v) },
      { title: "Capex（亿）", dataIndex: "capex", width: 110, render: (v: number) => fmt(v) },
      { title: "D&A（亿）", dataIndex: "da", width: 100, render: (v: number) => fmt(v) },
      { title: "行业", dataIndex: "industry", width: 110, render: (v: string) => v || "-" },
    ],
    [],
  );

  return (
    <AppHeader
      title="估值看板"
      actions={
        <Space wrap size={8}>
          <Button
            icon={<ReloadOutlined spin={loading || chartLoading} />}
            onClick={handleRefresh}
          >
            刷新
          </Button>
          <Dropdown
            menu={{
              items: [
                { key: "import", icon: <ImportOutlined />, label: "导入 JSON" },
                { key: "export", icon: <ExportOutlined />, label: "导出 JSON" },
              ],
              onClick: ({ key }) => {
                if (key === "import") setImportModalOpen(true);
                if (key === "export") void handleExport();
              },
            }}
          >
            <Button>数据管理 <DownOutlined /></Button>
          </Dropdown>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => router.push("/model/edit")}
          >
            新增估值标的
          </Button>
        </Space>
      }
    >
      <section className="metrics-row">
        <div className="metric-cell">
          <label>跟踪标的</label>
          <strong>{companies.length}</strong>
        </div>
        <div className="metric-cell">
          <label>平均潜在空间</label>
          <strong className={averageUpside >= 0 ? "txt-pos" : "txt-neg"}>
            {fmtPct(averageUpside)}
          </strong>
        </div>
        <div className="metric-cell">
          <label>正空间标的</label>
          <strong>{positiveCount}</strong>
        </div>
        <div className="metric-cell">
          <label>最近更新</label>
          <strong className="metric-date">
            {latestDate(companies.flatMap((company) => [company.quoteUpdatedAt, company.lastEvalDate]))}
          </strong>
        </div>
      </section>

      <section className="dashboard-charts" aria-label="估值图表">
        <div className="chart-panel chart-panel-wide">
          <div className="panel-heading">
            <div>
              <h2>股价与 DCF 目标价走势</h2>
            </div>
            {companies.length > 0 && (
              <Select
                aria-label="走势图标的"
                value={selectedCompany?.id}
                onChange={setSelectedId}
                options={companies.map((company) => ({
                  value: company.id,
                  label: `${company.name} ${company.ticker}`,
                }))}
                className="company-select"
                showSearch
                optionFilterProp="label"
              />
            )}
          </div>
          {chartError && (
            <Alert
              type="warning"
              showIcon
              message={chartError}
              action={<Button size="small" onClick={loadSelectedPrices}>重试</Button>}
              className="chart-alert"
            />
          )}
          {chartLoading ? (
            <div className="chart-empty"><Spin /></div>
          ) : selectedCompany ? (
            <PriceTargetChart
              prices={prices}
              valuation={valuation}
              targetPrice={selectedCompany.targetPrice}
            />
          ) : (
            <div className="chart-empty">暂无走势</div>
          )}
        </div>

        <div className="chart-panel">
          <div className="panel-heading">
            <div>
              <h2>潜在空间对比</h2>
            </div>
          </div>
          {loading ? (
            <div className="chart-empty"><Spin /></div>
          ) : (
            <UpsideComparison
              companies={companies}
              selectedId={selectedCompany?.id}
              onSelect={setSelectedId}
            />
          )}
        </div>
      </section>

      <div className="section-head research-table-head">
        <div>
          <h2>标的列表</h2>
        </div>
        <div className="table-tools">
          <Select
            aria-label="按四象限筛选"
            value={quadrantFilter || "all"}
            onChange={(value) => setQuadrantFilter(value === "all" ? "" : value)}
            options={quadrantOptions}
          />
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索名称或代码"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            allowClear
          />
        </div>
      </div>
      <div className="research-table-wrap">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          scroll={{ x: 1390 }}
          size="middle"
          className="fin-table"
          rowClassName={(record) => record.id === selectedCompany?.id ? "selected-research-row" : ""}
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id),
            style: { cursor: "pointer" },
          })}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
        />
      </div>

      <details className="baseline-details">
        <summary>
          <span>
            <strong>基准库财务对照</strong>
          </span>
          <DownOutlined />
        </summary>
        <div className="baseline-table-wrap">
          <Table
            rowKey="id"
            columns={baselineColumns}
            dataSource={baselineCompanies}
            loading={baselineLoading}
            scroll={{ x: 1640 }}
            size="small"
            className="fin-table"
            pagination={false}
          />
        </div>
      </details>

      <Modal
        title="导入 JSON"
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        footer={null}
      >
        <Upload accept=".json,application/json" showUploadList={false} beforeUpload={handleImport}>
          <Button icon={<ImportOutlined />}>选择 JSON 文件</Button>
        </Upload>
      </Modal>
    </AppHeader>
  );
}
