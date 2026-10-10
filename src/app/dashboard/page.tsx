"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Row,
  Col,
  Statistic,
  Tag,
  Table,
  Button,
  Space,
  Input,
  Modal,
  Upload,
  App,
  Tooltip,
  Typography,
} from "antd";
import {
  PlusOutlined,
  ImportOutlined,
  ExportOutlined,
  ReloadOutlined,
  FileTextOutlined,
  SearchOutlined,
  FileSearchOutlined,
  RobotOutlined,
  BulbOutlined,
  BulbFilled,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useTheme } from "@/app/providers";
import type { ColumnsType } from "antd/es/table";

const { Title } = Typography;

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
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [baselineCompanies, setBaselineCompanies] = useState<BaselineCompany[]>([]);
  const [baselineLoading, setBaselineLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [quadrantFilter, setQuadrantFilter] = useState<string>("");
  const [keyword, setKeyword] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const { message } = App.useApp();
  const { mode, toggle } = useTheme();

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
  }, []);

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
  const avgUpside =
    total > 0
      ? companies.reduce((s, c) => s + c.upside, 0) / total
      : 0;
  const avgOriginal =
    total > 0
      ? companies.reduce((s, c) => s + c.originalUpside, 0) / total
      : 0;

  const quadrantCounts = QUADRANTS.map((q) => ({
    ...q,
    count: companies.filter((c) => c.quadrant === q.key).length,
  }));

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

  const handleImport = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/import", {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      const json = await res.json();
      message.success(`导入完成：新增 ${json.created} 条，跳过 ${json.skipped} 条`);
      setImportModalOpen(false);
      loadData();
    } else {
      const err = await res.json().catch(() => ({}));
      message.error(err.error ?? "导入失败");
    }
    return false;
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/export");
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
  const columns: ColumnsType<Company> = [
    {
      title: "标的简称",
      dataIndex: "name",
      fixed: "left",
      width: 130,
      render: (_, r) => (
        <div>
          <div className="font-semibold text-slate-800">{r.name}</div>
          <div className="text-xs text-slate-400">{r.ticker}</div>
        </div>
      ),
    },
    {
      title: "最新市价",
      dataIndex: "currentPrice",
      width: 90,
      className: "font-mono-num",
      render: (v: number) => (
        <span>¥{fmt(v, 2)}</span>
      ),
    },
    {
      title: "★调整后潜在空间",
      dataIndex: "upside",
      width: 130,
      render: (v: number, r) => (
        <div>
          <div className={v >= 0 ? "txt-pos" : "txt-neg"}>
            {fmtPct(v)}
          </div>
          <div className="text-xs text-slate-400">
            目标 ¥{fmt(r.targetPrice, 2)}
          </div>
        </div>
      ),
    },
    {
      title: "前次评估",
      dataIndex: "originalUpside",
      width: 110,
      render: (v: number, r) => (
        <Tooltip title={`原版空间 ${fmtPct(v)}`}>
          <div className={v >= 0 ? "txt-pos" : "txt-neg"}>{fmtPct(v)}</div>
          {r.lastEvalDate && (
            <div className="text-xs text-slate-400">
              {new Date(r.lastEvalDate).toLocaleDateString()}
            </div>
          )}
        </Tooltip>
      ),
    },
    {
      title: "DCF正向终局利润(Y20)",
      dataIndex: "terminalProfitY20",
      width: 130,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 1)} 亿</span>,
    },
    {
      title: "终局FCF/E3",
      dataIndex: "terminalFcfE3",
      width: 100,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 2)}x</span>,
    },
    {
      title: "★市场隐含终局利润(L)",
      dataIndex: "impliedL",
      width: 140,
      className: "font-mono-num",
      render: (v: number) => <span className="txt-mid">{fmt(v, 1)} 亿</span>,
    },
    {
      title: "L/E3(反算)",
      dataIndex: "impliedLE3",
      width: 110,
      className: "font-mono-num",
      render: (v: number) => (
        <span className={v >= 0 ? "txt-neg" : "txt-pos"}>{fmt(v, 2)}x</span>
      ),
    },
    {
      title: "隐含终局CAGR(20y)",
      dataIndex: "impliedCagr",
      width: 130,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 1)}%</span>,
    },
    {
      title: "终局利润估计",
      dataIndex: "terminalProfitEst",
      width: 120,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 1)} 亿</span>,
    },
    {
      title: "过渡期年化g",
      dataIndex: "transitionG",
      width: 110,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v * 100, 2)}%</span>,
    },
    {
      title: "WACC",
      dataIndex: "wacc",
      width: 80,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v * 100, 2)}%</span>,
    },
    {
      title: "叙事分级诊断",
      dataIndex: "diagnosis",
      width: 150,
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
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "操作",
      key: "action",
      fixed: "right",
      width: 220,
      render: (_, r) => (
        <Space size={8} wrap={false} style={{ whiteSpace: "nowrap" }}>
          <Button
            size="small"
            type="link"
            onClick={() => router.push(`/report/${r.id}`)}
          >
            详情
          </Button>
          <Button
            size="small"
            type="link"
            onClick={() => router.push(`/model/edit?id=${r.id}`)}
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
  const baselineColumns: ColumnsType<BaselineCompany> = [
    {
      title: "标的",
      dataIndex: "name",
      fixed: "left",
      width: 150,
      render: (_, r) => (
        <div>
          <div className="font-semibold text-slate-800">{r.name}</div>
          <div className="text-xs text-slate-400">{r.ticker}</div>
        </div>
      ),
    },
    {
      title: "最新市价",
      dataIndex: "currentPrice",
      width: 90,
      className: "font-mono-num",
      render: (v: number) => <span>¥{fmt(v, 2)}</span>,
    },
    {
      title: "总股本(亿股)",
      dataIndex: "shares",
      width: 100,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 2)}</span>,
    },
    {
      title: "市值(亿)",
      dataIndex: "marketCap",
      width: 100,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "货币资金(亿)",
      dataIndex: "cash",
      width: 100,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "有息负债(亿)",
      dataIndex: "debt",
      width: 100,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "净现金(亿)",
      dataIndex: "netCash",
      width: 100,
      className: "font-mono-num",
      render: (v: number) => (
        <span className={v >= 0 ? "txt-pos" : "txt-neg"}>{fmt(v, 1)}</span>
      ),
    },
    {
      title: "E0净利(亿)",
      dataIndex: "e0",
      width: 90,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "营收S0(亿)",
      dataIndex: "revenue",
      width: 100,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "净资产B0(亿)",
      dataIndex: "bookValue",
      width: 100,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "CFO(亿)",
      dataIndex: "cfo",
      width: 90,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "Capex(亿)",
      dataIndex: "capex",
      width: 90,
      className: "font-mono-num",
      render: (v: number) => <span>{fmt(v, 1)}</span>,
    },
    {
      title: "D&A(亿)",
      dataIndex: "da",
      width: 90,
      className: "font-mono-num",
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
    <div className="min-h-screen">
      {/* 顶部品牌栏 */}
      <div className="brand-header px-6 py-3 flex items-center justify-between">
        <div>
          <Title level={4} style={{ color: "#fff", margin: 0 }}>
            DCF 估值穿透与弹性空间测算终端
          </Title>
          <div className="text-xs text-blue-100">
            正向 20 年 DCF 内在价值 + 逆向终局利润 L 反算 · 安全：服务端二次校验
          </div>
        </div>
        <Space>
          <Tooltip title={mode === "dark" ? "切换浅色" : "切换深色"}>
            <Button
              icon={mode === "dark" ? <BulbFilled /> : <BulbOutlined />}
              onClick={toggle}
            />
          </Tooltip>
          <Button icon={<ReloadOutlined />} onClick={loadData}>
            一键刷新
          </Button>
          <Button
            icon={<FileSearchOutlined />}
            onClick={() => router.push("/announcements")}
          >
            公告中心
          </Button>
          <Button icon={<RobotOutlined />} onClick={() => router.push("/agent")}>
            智能体对话
          </Button>
          <Button icon={<FileTextOutlined />}>另存为 HTML</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => router.push("/model/edit")}
          >
            新增估值标的
          </Button>
          <Button icon={<ImportOutlined />} onClick={() => setImportModalOpen(true)}>
            导入 JSON
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            导出 JSON
          </Button>
        </Space>
      </div>

      <div className="p-6">
        {/* 指标卡 + 四象限 */}
        <Row gutter={[16, 16]} className="mb-4">
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="重点监控标的总数"
                value={total}
                suffix="家"
                styles={{ content: { color: "#1d4ed8" } }}
              />
              <div className="text-xs text-slate-400 mt-1">
                覆盖 A/H 股核心制造标的
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="平均潜在上行空间（调整后口径）"
                value={avgUpside}
                precision={1}
                suffix="%"
                styles={{ content: { color: avgUpside >= 0 ? "#16a34a" : "#dc2626" } }}
                prefix={avgUpside >= 0 ? "+" : ""}
              />
              <div className="text-xs text-slate-400 mt-1">
                正向 DCF 原版均值：{fmtPct(avgOriginal)}
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card title="四象限诊断 · 点击筛选">
              <Space wrap>
                {quadrantCounts.map((q) => {
                  const active = quadrantFilter === q.key;
                  const bg = q.color === "green" ? "#16a34a" : "#dc2626";
                  return (
                    <Tag.CheckableTag
                      key={q.key}
                      checked={active}
                      onChange={(checked) =>
                        setQuadrantFilter(checked ? q.key : "")
                      }
                      style={{
                        padding: "4px 10px",
                        borderRadius: 12,
                        background: active ? bg : "#fff",
                        color: active ? "#fff" : "#475569",
                        border: `1px solid ${active ? bg : "#e2e8f0"}`,
                      }}
                    >
                      {q.key}
                      <span className="ml-1 font-bold">{q.count}</span>家
                    </Tag.CheckableTag>
                  );
                })}
              </Space>
            </Card>
          </Col>
        </Row>

        {/* 排行榜表格 */}
        <Card
          title={
            <span>
              📊 估值穿透全景排行榜
              <span className="text-xs text-slate-400 ml-2 font-normal">
                （表头与公司名列已永久锁定，支持横纵向自由拖拽）
              </span>
            </span>
          }
          extra={
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索代码、标的简称…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ width: 240 }}
              allowClear
            />
          }
        >
          <Table
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            loading={loading}
            scroll={{ x: 1900, y: 520 }}
            sticky={{ offsetHeader: 64 }}
            size="middle"
            className="fin-table"
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        </Card>

        {/* 基准库档案对照（只读参考） */}
        <Card
          className="mt-4"
          title={
            <span>
              🏛 基准库档案对照
              <span className="text-xs text-slate-400 ml-2 font-normal">
                （只读参考 · 上方排行榜为你的用户库数据，此处为基准库原始档案，便于对照差异）
              </span>
            </span>
          }
        >
          <Table
            rowKey="id"
            columns={baselineColumns}
            dataSource={baselineCompanies}
            loading={baselineLoading}
            scroll={{ x: 1400 }}
            size="small"
            className="fin-table"
            pagination={false}
          />
        </Card>
      </div>

      {/* 导入弹窗 */}
      <Modal
        title="导入 JSON"
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        footer={null}
      >
        <Upload
          accept=".json,application/json"
          showUploadList={false}
          beforeUpload={handleImport}
        >
          <Button icon={<ImportOutlined />}>选择 JSON 文件</Button>
        </Upload>
        <p className="text-xs text-slate-400 mt-3">
          文件需符合系统 Schema，最大 5MB。重复 ticker 将被跳过。
        </p>
      </Modal>
    </div>
  );
}
