"use client";

/**
 * 公告中心 —— 公告智能体前端
 * 功能：选择标的 → 按需拉取近 N 天公告并分析 → 公告列表 + 预期差信号卡片
 * LLM 未配置时：只展示公告采集结果，信号分析自动跳过（页面有提示）。
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
  Alert,
  Typography,
  Empty,
} from "antd";
import { ReloadOutlined, FileSearchOutlined, ArrowLeftOutlined, RobotOutlined } from "@ant-design/icons";
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

/** 公告（Announcement + signals） */
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

interface SyncResult {
  fetched: number;
  added: number;
  failed: { code: string; title: string; reason: string }[];
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

  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

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

  const handleSync = async () => {
    if (!companyId) {
      message.warning("请先选择标的");
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch(
        `/api/announcements/${companyId}/sync?days=${days}`,
        { method: "POST", cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok) {
        message.error(json.error ?? "同步失败");
        return;
      }
      setLastSync(json as SyncResult);
      message.success(`同步完成：新增 ${json.added} 条公告`);
      loadAnnouncements(1);
    } catch {
      message.error("同步请求失败，请稍后重试");
    } finally {
      setSyncing(false);
    }
  };

  const columns: ColumnsType<AnnouncementItem> = [
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
            巨潮资讯 A 股公告按需采集 · 预期差分析在「智能体对话」页完成
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
              icon={<FileSearchOutlined />}
              loading={syncing}
              onClick={handleSync}
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

          {lastSync && (
            <Alert
              className="mt-3"
              type={lastSync.failed.length ? "warning" : "success"}
              showIcon
              message={`同步完成：拉取 ${lastSync.fetched} 条 · 新增 ${lastSync.added} 条 · 失败 ${lastSync.failed.length} 条`}
              description={
                lastSync.failed.length
                  ? `部分公告处理失败：${lastSync.failed.map((f) => f.title).join("；")}`
                  : "公告已采集入库。预期差分析请前往「智能体对话」页，要求智能体分析公告即可生成信号。"
              }
            />
          )}
        </Card>

        <Card>
          {items.length === 0 && !loading ? (
            <Empty description="暂无公告。选择标的并点击「拉取公告」采集，或前往智能体对话页让智能体拉取。" />
          ) : (
            <Table
              rowKey="id"
              columns={columns}
              dataSource={items}
              loading={loading}
              expandable={{ expandedRowRender: expandableRender }}
              scroll={{ x: 900 }}
              size="middle"
              className="fin-table"
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
