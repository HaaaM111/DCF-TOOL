"use client";

/**
 * 公告中心 —— 公告采集与信号展示
 * ------------------------------------------------------------------
 * 工作流：选择标的 → 「拉取公告」拉取候选（不入库）→ 勾选 → 「存储选中」正式入库
 *        已入库公告可勾选「删除选中」（关联信号级联删除）。
 * 预期差分析在「智能体对话」页完成；信号入库后在本页展示。
 */
import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Select,
  Button,
  Space,
  Table,
  Tag,
  App,
  Typography,
  Empty,
} from "antd";
import {
  ReloadOutlined,
  CloudDownloadOutlined,
  SaveOutlined,
  DeleteOutlined,
  ArrowLeftOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import type { ColumnsType } from "antd/es/table";

const { Title, Paragraph, Text } = Typography;

/** 标的（与 /api/companies 返回一致） */
interface CompanyOption {
  id: string;
  name: string;
  ticker: string;
}

/** 信号（AnnouncementSignal） */
interface Signal {
  id: string;
  expectation: string;
  direction: string;
  summary: string;
  evidence: string;
  suggestedChanges: {
    field: string;
    action: string;
    from?: number;
    to?: number;
    reason: string;
  }[];
}

/** 公告（Announcement + signals，已入库） */
interface AnnouncementItem {
  id: string;
  companyId: string;
  source: string;
  code: string;
  title: string;
  publishAt: string;
  category: string;
  pdfUrl: string;
  analyzed: boolean;
  signals: Signal[];
}

/** 候选公告（拉取后未入库，待用户选择） */
interface CandidateItem {
  code: string;
  title: string;
  publishAt: string;
  category: string;
  pdfUrl: string;
  adjunctSizeKb: number;
}

interface FetchResult {
  fetched: number;
  candidates: CandidateItem[];
  cached: boolean;
}

interface StoreResult {
  stored: number;
  skipped: number;
  failed: { code: string; title: string; reason: string }[];
}

interface DeleteResult {
  deleted: number;
}

const CATEGORIES = [
  "业绩预告",
  "定期报告",
  "回购",
  "增减持",
  "重大合同",
  "股权激励",
  "分红",
  "风险",
  "其他",
];

/** 分类 → Tag 颜色 */
const CATEGORY_COLORS: Record<string, string> = {
  业绩预告: "volcano",
  定期报告: "blue",
  回购: "green",
  增减持: "orange",
  重大合同: "cyan",
  股权激励: "purple",
  分红: "gold",
  风险: "red",
  其他: "default",
};

/** 预期 → Tag 颜色 */
const EXPECTATION_COLORS: Record<string, string> = {
  超预期: "green",
  符合预期: "blue",
  低于预期: "red",
  无法判断: "default",
};

const fmtTime = (s: string) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "-";

export default function AnnouncementsPage() {
  const router = useRouter();
  const { message } = App.useApp();

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState<string>();
  const [category, setCategory] = useState<string>();
  const [days, setDays] = useState(30);

  // 已入库公告列表
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 拉取候选（未入库）
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [candidateKeys, setCandidateKeys] = useState<React.Key[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [storeLoading, setStoreLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 加载标的列表
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/companies", { cache: "no-store" });
        const json = await res.json();
        setCompanies(json.companies ?? []);
      } catch {
        message.error("加载标的列表失败");
      }
    })();
  }, [message]);

  const loadAnnouncements = useCallback(
    async (targetPage: number) => {
      if (!companyId) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          companyId,
          page: String(targetPage),
          pageSize: String(pageSize),
          days: String(days),
        });
        if (category) params.set("category", category);
        const res = await fetch(`/api/announcements?${params}`, { cache: "no-store" });
        const json = await res.json();
        setItems(json.items ?? []);
        setTotal(json.total ?? 0);
        setPage(json.page ?? 1);
        setSelectedRowKeys([]);
      } catch {
        message.error("加载公告列表失败");
      } finally {
        setLoading(false);
      }
    },
    [companyId, category, days, pageSize, message],
  );

  useEffect(() => {
    if (companyId) loadAnnouncements(page);
  }, [companyId, category, days, pageSize, page, loadAnnouncements]);

  /** 拉取候选公告（不入库） */
  const handleFetch = async () => {
    if (!companyId) {
      message.warning("请先选择标的");
      return;
    }
    setFetchLoading(true);
    try {
      const res = await fetch(`/api/announcements/${companyId}/sync?days=${days}`, {
        method: "POST",
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        message.error(json.error ?? "拉取失败");
        return;
      }
      const result = json as FetchResult;
      setCandidates(result.candidates ?? []);
      setCandidateKeys([]);
      if (result.candidates.length) {
        message.success(
          result.cached
            ? `命中缓存：候选 ${result.fetched} 条（10 分钟内拉取过）`
            : `拉取到 ${result.fetched} 条候选公告，勾选后点「存储选中」入库`,
        );
      } else {
        message.info("该时间段内没有新公告");
      }
    } catch {
      message.error("拉取请求失败，请稍后重试");
    } finally {
      setFetchLoading(false);
    }
  };

  /** 存储选中的候选公告（正式入库） */
  const handleStore = async () => {
    if (!companyId || !candidateKeys.length) {
      message.warning("请先勾选要存储的候选公告");
      return;
    }
    setStoreLoading(true);
    try {
      const res = await fetch(`/api/announcements/${companyId}/store`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: candidateKeys }),
      });
      const json = await res.json();
      if (!res.ok) {
        message.error(json.error ?? "存储失败");
        return;
      }
      const result = json as StoreResult;
      // 移除已存储的候选
      const storedSet = new Set(candidateKeys.map((k) => String(k)));
      setCandidates((prev) => prev.filter((c) => !storedSet.has(c.code)));
      setCandidateKeys([]);
      message.success(
        `已存储 ${result.stored} 条，跳过 ${result.skipped} 条（已存在/无正文）` +
          (result.failed.length ? `，失败 ${result.failed.length} 条` : ""),
      );
      loadAnnouncements(1);
    } catch {
      message.error("存储请求失败");
    } finally {
      setStoreLoading(false);
    }
  };

  /** 丢弃选中的候选（不入库） */
  const handleDiscard = () => {
    if (!candidateKeys.length) {
      setCandidates([]);
      return;
    }
    const dropSet = new Set(candidateKeys.map((k) => String(k)));
    setCandidates((prev) => prev.filter((c) => !dropSet.has(c.code)));
    setCandidateKeys([]);
  };

  /** 删除已入库的选中公告（关联信号级联删除） */
  const handleDelete = async () => {
    if (!companyId || !selectedRowKeys.length) {
      message.warning("请先勾选要删除的公告");
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/announcements/${companyId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedRowKeys }),
      });
      const json = await res.json();
      if (!res.ok) {
        message.error(json.error ?? "删除失败");
        return;
      }
      const result = json as DeleteResult;
      message.success(`已删除 ${result.deleted} 条公告（关联信号一并删除）`);
      loadAnnouncements(1);
    } catch {
      message.error("删除请求失败");
    } finally {
      setDeleteLoading(false);
    }
  };

  /** 候选表格列 */
  const candidateColumns: ColumnsType<CandidateItem> = [
    {
      title: "发布时间",
      dataIndex: "publishAt",
      width: 150,
      render: (v: string) => <span className="text-slate-500">{fmtTime(v)}</span>,
    },
    {
      title: "公告标题",
      dataIndex: "title",
      width: 420,
      render: (v: string, r) => (
        <a href={r.pdfUrl} target="_blank" rel="noreferrer" className="text-blue-600">
          {v}
        </a>
      ),
    },
    {
      title: "分类",
      dataIndex: "category",
      width: 100,
      render: (v: string) => <Tag color={CATEGORY_COLORS[v] ?? "default"}>{v}</Tag>,
    },
  ];

  /** 已入库表格列 */
  const savedColumns: ColumnsType<AnnouncementItem> = [
    {
      title: "发布时间",
      dataIndex: "publishAt",
      width: 150,
      render: (v: string) => <span className="text-slate-500">{fmtTime(v)}</span>,
    },
    {
      title: "公告标题",
      dataIndex: "title",
      width: 420,
      render: (v: string, r) => (
        <a href={r.pdfUrl} target="_blank" rel="noreferrer" className="text-blue-600">
          {v}
        </a>
      ),
    },
    {
      title: "分类",
      dataIndex: "category",
      width: 100,
      render: (v: string) => <Tag color={CATEGORY_COLORS[v] ?? "default"}>{v}</Tag>,
    },
    {
      title: "分析状态",
      dataIndex: "analyzed",
      width: 110,
      render: (_, r) =>
        r.signals.length ? (
          <Tag color="green">已分析</Tag>
        ) : (
          <a
            className="text-blue-600"
            onClick={(e) => {
              e.preventDefault();
              router.push(`/agent?companyId=${encodeURIComponent(r.companyId)}`);
            }}
          >
            去智能体分析
          </a>
        ),
    },
    {
      title: "预期判断",
      key: "expectation",
      width: 110,
      render: (_, r) =>
        r.signals[0] ? (
          <Tag color={EXPECTATION_COLORS[r.signals[0].expectation] ?? "default"}>
            {r.signals[0].expectation}
          </Tag>
        ) : (
          "-"
        ),
    },
  ];

  /** 展开行：信号卡片（摘要 + 原文证据 + 假设修正建议） */
  const expandableRender = (r: AnnouncementItem) => {
    if (!r.signals.length) {
      return (
        <div className="py-2 text-slate-400 text-sm">
          该公告尚未在智能体中分析。前往「智能体对话」页要求分析即可生成预期差信号。
        </div>
      );
    }
    return (
      <div className="py-2">
        {r.signals.map((s) => (
          <Card key={s.id} size="small" className="mb-2" style={{ maxWidth: 900 }}>
            <Space wrap className="mb-2">
              <Tag color={EXPECTATION_COLORS[s.expectation] ?? "default"}>
                {s.expectation}
              </Tag>
              <Tag
                color={s.direction === "positive" ? "green" : s.direction === "negative" ? "red" : "default"}
              >
                {s.direction === "positive"
                  ? "利好"
                  : s.direction === "negative"
                    ? "利空"
                    : "中性"}
              </Tag>
            </Space>
            <Paragraph className="mb-1">{s.summary || "-"}</Paragraph>
            {s.evidence && (
              <div className="text-sm text-slate-500 border-l-2 border-slate-300 pl-3 mb-2">
                <div className="text-xs text-slate-400 mb-1">原文证据：</div>
                {s.evidence.split("\n").map((line, i) => (
                  <div key={i}>“{line}”</div>
                ))}
              </div>
            )}
            {s.suggestedChanges.length > 0 && (
              <div className="mt-2">
                <Text strong className="text-sm">
                  假设修正建议：
                </Text>
                <Table
                  size="small"
                  rowKey={(c) => `${c.field}-${c.action}`}
                  pagination={false}
                  dataSource={s.suggestedChanges}
                  columns={[
                    {
                      title: "字段",
                      dataIndex: "field",
                      width: 140,
                      render: (v: string) => <code>{v}</code>,
                    },
                    {
                      title: "动作",
                      dataIndex: "action",
                      width: 70,
                      render: (v: string) => (
                        <Tag
                          color={v === "上调" ? "green" : v === "下调" ? "red" : "default"}
                        >
                          {v}
                        </Tag>
                      ),
                    },
                    {
                      title: "从 → 到",
                      key: "range",
                      width: 140,
                      render: (_, c) => (
                        <span className="font-mono-num">
                          {c.from != null ? c.from : "-"} →{" "}
                          {c.to != null ? c.to : "-"}
                        </span>
                      ),
                    },
                    { title: "理由", dataIndex: "reason" },
                  ]}
                />
              </div>
            )}
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="brand-header px-6 py-3 flex items-center justify-between">
        <div>
          <Title level={4} style={{ color: "#fff", margin: 0 }}>
            公告中心
          </Title>
          <div className="text-xs text-blue-100">
            拉取候选 → 勾选存储入库 · 预期差分析在「智能体对话」页完成
          </div>
        </div>
        <Space>
          <Button
            icon={<RobotOutlined />}
            onClick={() =>
              companyId
                ? router.push(`/agent?companyId=${encodeURIComponent(companyId)}`)
                : router.push("/agent")
            }
          >
            智能体分析
          </Button>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push("/dashboard")}>
            返回看板
          </Button>
        </Space>
      </div>

      <div className="p-6">
        <Card className="mb-4">
          <Space wrap>
            <Select
              showSearch
              placeholder="选择标的"
              style={{ width: 260 }}
              value={companyId}
              onChange={(v) => {
                setCompanyId(v);
                setPage(1);
                setCandidates([]);
                setCandidateKeys([]);
              }}
              optionFilterProp="label"
              options={companies.map((c) => ({
                value: c.id,
                label: `${c.name}（${c.ticker}）`,
              }))}
            />
            <Select
              allowClear
              placeholder="公告分类（全部）"
              style={{ width: 150 }}
              value={category}
              onChange={(v) => {
                setCategory(v);
                setPage(1);
              }}
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
            <Select
              style={{ width: 130 }}
              value={days}
              onChange={(v) => {
                setDays(v);
                setPage(1);
              }}
              options={[
                { value: 7, label: "近 7 天" },
                { value: 30, label: "近 30 天" },
                { value: 90, label: "近 90 天" },
              ]}
            />
            <Button
              type="primary"
              icon={<CloudDownloadOutlined />}
              loading={fetchLoading}
              onClick={handleFetch}
            >
              拉取公告
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => loadAnnouncements(1)}
            >
              刷新列表
            </Button>
          </Space>
        </Card>

        {candidates.length > 0 && (
          <Card
            className="mb-4"
            title={`拉取结果 · 待存储（${candidates.length} 条，勾选后点「存储选中」入库；刷新页面候选将丢失）`}
            extra={
              <Space>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={storeLoading}
                  disabled={!candidateKeys.length}
                  onClick={handleStore}
                >
                  存储选中（{candidateKeys.length}）
                </Button>
                <Button
                  icon={<DeleteOutlined />}
                  disabled={!candidateKeys.length}
                  onClick={handleDiscard}
                >
                  丢弃选中
                </Button>
              </Space>
            }
          >
            <Table
              rowKey="code"
              size="small"
              columns={candidateColumns}
              dataSource={candidates}
              pagination={false}
              scroll={{ x: 700 }}
              rowSelection={{
                selectedRowKeys: candidateKeys,
                onChange: setCandidateKeys,
              }}
            />
          </Card>
        )}

        <Card
          title={`已入库公告（${total} 条）`}
          extra={
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={deleteLoading}
              disabled={!selectedRowKeys.length}
              onClick={handleDelete}
            >
              删除选中（{selectedRowKeys.length}）
            </Button>
          }
        >
          {items.length === 0 && !loading ? (
            <Empty description="暂无已入库公告。选择标的并点「拉取公告」，勾选后「存储选中」入库。" />
          ) : (
            <Table
              rowKey="id"
              columns={savedColumns}
              dataSource={items}
              loading={loading}
              expandable={{ expandedRowRender: expandableRender }}
              scroll={{ x: 900 }}
              size="middle"
              className="fin-table"
              rowSelection={{
                selectedRowKeys,
                onChange: setSelectedRowKeys,
              }}
              pagination={{
                current: page,
                pageSize,
                total,
                showSizeChanger: true,
                showTotal: (t) => `共 ${t} 条`,
                onChange: (p, ps) => {
                  setPage(p);
                  setPageSize(ps);
                },
              }}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
