"use client";

/**
 * 智能体对话页 —— 独立智能体页面
 * ------------------------------------------------------------------
 * 顶部绑定标的；对话基于该标的 DCF 假设 + 已入库公告信号；
 * 用户可要求智能体重新拉取公告（sync_announcements）或分析公告（analyze_announcements）。
 * 对话持久化：成功交互后由本页调用 POST /api/agent/conversations 落库；
 * 进入页面/切换标的时读取历史（GET），刷新不丢。
 * LLM 未配置（env/DB 均无 key）时对话不可用，页面引导配置。
 */
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Select,
  Button,
  Tag,
  App,
  Alert,
  Modal,
  Form,
  Input,
  Typography,
  Spin,
} from "antd";
import {
  SendOutlined,
  SettingOutlined,
  PlusOutlined,
  MenuOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import AppHeader from "@/components/app-header";

const { Paragraph, Text } = Typography;

/** 历史为空时的默认欢迎语 */
const DEFAULT_WELCOME =
  "你好，我是公告智能体。先在上方选择标的，之后我会基于该公司的 DCF 假设与已入库公告信号回答问题；需要时你也可以让我重新拉取或分析公告。";

/** 历史列表项（一个标的对应一条连续会话） */
interface HistoryItem {
  company: CompanyOption;
  lastAt: string;
  lastContent: string;
  count: number;
}

/** 历史栏时间显示（今天 HH:mm / 昨天 / N 天前 / M-D） */
function relTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (diffDays === 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;
  return `${d.getMonth() + 1}-${pad(d.getDate())}`;
}

/** 历史栏预览文案：折行压平并截断 */
function previewText(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 30);
}

/** 绑定标的后统一标准开场语（所有标的一致） */
function buildBindMessage(name: string, ticker: string): string {
  return `已绑定标的：${name}（${ticker}）。我是公告智能体，基于该公司的 DCF 假设与已入库公告工作。你可以：
① 拉取公告 —— 说“拉取近 N 天公告”（1~90 天）
② 分析公告 —— 说“分析公告”，我会对未分析公告生成预期差信号与假设修正建议
③ 查看信号 —— 问“有哪些预期差信号”
④ 假设影响 —— 问“公告对 g1、ke 等假设有什么影响”
对话与信号结果都会同步保存，随时可回溯。`;
}

interface CompanyOption {
  id: string;
  name: string;
  ticker: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface CfgState {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyMasked: string;
  source: "env" | "db" | "none";
}

export default function AgentPage() {
  const { message } = App.useApp();

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState<string>();
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: DEFAULT_WELCOME },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [cfg, setCfg] = useState<CfgState | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [form] = Form.useForm();

  const bottomRef = useRef<HTMLDivElement>(null);

  /** 拉取历史会话列表：逐标的读取已有对话（复用现有 GET 接口），按最近时间排序 */
  const loadHistory = useCallback(async (list: CompanyOption[]) => {
    const items = await Promise.all(
      list.map(async (company) => {
        try {
          const res = await fetch(
            `/api/agent/conversations?companyId=${encodeURIComponent(company.id)}`,
            { cache: "no-store" },
          );
          const json = await res.json();
          const msgs = (json.items ?? []) as {
            role: string;
            content: string;
            createdAt: string;
          }[];
          const last = msgs[msgs.length - 1];
          return {
            company,
            lastAt: last?.createdAt ?? "",
            lastContent: last?.content ?? "",
            count: msgs.length,
          };
        } catch {
          return { company, lastAt: "", lastContent: "", count: 0 };
        }
      }),
    );
    setHistory(
      items
        .filter((it) => it.count > 0)
        .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)),
    );
  }, []);

  /** 单次对话结束后刷新对应标的的历史栏条目 */
  const refreshOne = useCallback(
    async (cid: string) => {
      const company = companies.find((c) => c.id === cid);
      if (!company) return;
      try {
        const res = await fetch(
          `/api/agent/conversations?companyId=${encodeURIComponent(cid)}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        const msgs = (json.items ?? []) as {
          role: string;
          content: string;
          createdAt: string;
        }[];
        const last = msgs[msgs.length - 1];
        setHistory((prev) => {
          const rest = prev.filter((it) => it.company.id !== cid);
          if (!last) return rest;
          return [
            { company, lastAt: last.createdAt, lastContent: last.content, count: msgs.length },
            ...rest,
          ].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
        });
      } catch {
        /* 刷新失败不影响对话 */
      }
    },
    [companies],
  );

  const loadCompanies = useCallback(async () => {
    try {
      const res = await fetch("/api/companies", { cache: "no-store" });
      const json = await res.json();
      const list = (json.companies ?? []) as CompanyOption[];
      setCompanies(list);
      loadHistory(list);
    } catch {
      message.error("加载标的列表失败");
    }
  }, [message, loadHistory]);

  const loadCfg = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/config", { cache: "no-store" });
      const json = await res.json();
      setCfg(json as CfgState);
    } catch {
      setCfg(null);
    }
  }, []);

  useEffect(() => {
    loadCompanies();
    loadCfg();
  }, [loadCompanies, loadCfg]);

  /** 读取该标的的历史对话（正序）；无历史则保留标准绑定开场语 */
  const loadConversations = useCallback(
    async (cid: string) => {
      const company = companies.find((c) => c.id === cid);
      const bindMsg = company
        ? buildBindMessage(company.name, company.ticker)
        : DEFAULT_WELCOME;
      setMessages([{ role: "assistant", content: bindMsg }]);
      try {
        const res = await fetch(
          `/api/agent/conversations?companyId=${encodeURIComponent(cid)}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        const items = (json.items ?? []) as { role: string; content: string }[];
        if (items.length) {
          setMessages(
            items.map((m) => ({
              role: m.role === "user" ? "user" : "assistant",
              content: m.content,
            })),
          );
        }
        // 无历史：保留 bindMsg
      } catch {
        // 读取失败：保留 bindMsg
      }
    },
    [companies],
  );

  /** 追加对话记录（失败静默，不影响对话本身） */
  const saveConversations = useCallback(
    async (msgs: { role: "user" | "assistant"; content: string }[]) => {
      if (!companyId) return;
      try {
        await fetch("/api/agent/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, messages: msgs }),
        });
      } catch {
        /* 落库失败不阻塞对话 */
      }
    },
    [companyId],
  );

  /** 从 URL 参数恢复标的（如从公告中心「去智能体分析」跳转）；仅首次生效，切换标的不受 URL 残留影响 */
  const urlInitRef = useRef(false);
  useEffect(() => {
    if (urlInitRef.current || typeof window === "undefined") return;
    const cid = new URLSearchParams(window.location.search).get("companyId");
    if (cid) {
      if (companies.length) {
        if (companies.some((c) => c.id === cid)) {
          urlInitRef.current = true;
          setCompanyId(cid);
          loadConversations(cid);
        }
      }
      // cid 存在但公司列表未加载完：等 companies 就绪后再次进入
    } else {
      urlInitRef.current = true;
    }
  }, [companies, loadConversations]);

  const onCompanyChange = (v: string) => {
    setCompanyId(v);
    setMobileOpen(false);
    loadConversations(v);
  };

  /** 新对话：清除当前标的与消息，回到欢迎态 */
  const newChat = () => {
    setCompanyId(undefined);
    setMessages([{ role: "assistant", content: DEFAULT_WELCOME }]);
    setInput("");
    setMobileOpen(false);
  };

  /** 消息更新后自动滚动到底部 */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!companyId) {
      message.warning("请先选择标的");
      return;
    }
    const history = [...messages, { role: "user" as const, content: text }];
    setMessages(history);
    setInput("");
    setSending(true);
    try {
      const apiMsgs = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, messages: apiMsgs }),
      });
      const json = await res.json();
      if (!res.ok) {
        message.error(json.error ?? "请求失败");
        return;
      }
      if (!json.llmReady) {
        const guide =
          json.error ||
          "未配置 LLM API。请点击右上角「API 配置」填入 Base URL / API Key / Model 后再试。";
        setMessages((prev) => [...prev, { role: "assistant", content: guide }]);
        await saveConversations([{ role: "user", content: text }, { role: "assistant", content: guide }]);
        refreshOne(companyId);
        return;
      }
      if (json.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: json.reply }]);
        await saveConversations([
          { role: "user", content: text },
          { role: "assistant", content: json.reply },
        ]);
        refreshOne(companyId);
      } else if (json.error) {
        message.error(json.error);
      }
    } catch {
      message.error("请求失败，请稍后重试");
    } finally {
      setSending(false);
    }
  };

  /** 快捷按钮：拉取公告（仅采集）→ 分析未分析公告，串联完成后追加一条汇总说明 */
  const openConfig = () => {
    form.setFieldsValue({
      baseUrl: cfg?.baseUrl || "",
      model: cfg?.model || "",
      apiKey: "",
    });
    setConfigOpen(true);
  };

  const saveConfig = async () => {
    const values = await form.validateFields();
    setCfgSaving(true);
    try {
      const body: { baseUrl?: string; model?: string; apiKey?: string } = {};
      if (values.baseUrl?.trim()) body.baseUrl = values.baseUrl.trim();
      if (values.model?.trim()) body.model = values.model.trim();
      if (values.apiKey?.trim()) body.apiKey = values.apiKey.trim();
      const res = await fetch("/api/agent/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        message.error(json.error ?? "保存失败");
        return;
      }
      setCfg(json as CfgState);
      setConfigOpen(false);
      message.success("配置已保存（空字段保持原值）");
    } catch {
      message.error("保存失败");
    } finally {
      setCfgSaving(false);
    }
  };

  const activeHistory = history.find((it) => it.company.id === companyId);

  return (
    <div className="agent-shell">
      <AppHeader
        title="智能体对话"
        subtitle="绑定标的 · 基于 DCF 假设与公告信号问答 · 可要求重新拉取公告"
        actions={
          <Button icon={<SettingOutlined />} onClick={openConfig}>
            API 配置
          </Button>
        }
      />

      <div className="agent-main">
        {/* 移动端遮罩 */}
        {mobileOpen && (
          <div
            className="absolute inset-0 z-20 md:hidden"
            style={{ background: "rgba(15, 23, 42, 0.45)" }}
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* 左侧：历史记录 */}
        <aside
          className={`agent-sidebar fixed z-30 left-0 top-16 bottom-0 transition-transform duration-200 md:static md:top-0 md:z-auto md:translate-x-0 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="p-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <Button block type="primary" ghost icon={<PlusOutlined />} onClick={newChat}>
              新对话
            </Button>
          </div>
          <div
            className="px-4 pt-3 pb-1"
            style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.04em" }}
          >
            历史对话
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2">
            {history.length === 0 ? (
              <div
                className="text-center py-10 px-3"
                style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}
              >
                <MessageOutlined style={{ fontSize: 22, marginBottom: 8 }} />
                <div>暂无历史对话</div>
                <div>选择标的完成一次对话后，记录会自动保存到这里</div>
              </div>
            ) : (
              history.map((it) => (
                <button
                  key={it.company.id}
                  type="button"
                  className={`agent-history-item mb-1 ${
                    companyId === it.company.id ? "active" : ""
                  }`}
                  onClick={() => onCompanyChange(it.company.id)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex-1 min-w-0 truncate"
                      style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}
                    >
                      {it.company.name}
                      <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>
                        {"  "}
                        {it.company.ticker}
                      </span>
                    </span>
                    <span
                      className="shrink-0"
                      style={{ fontSize: 11, color: "var(--text-muted)" }}
                    >
                      {relTime(it.lastAt)}
                    </span>
                  </div>
                  <div
                    className="truncate mt-1"
                    style={{ fontSize: 12, color: "var(--text-secondary)" }}
                  >
                    {previewText(it.lastContent)}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* 右侧：对话区 */}
        <main className="flex-1 flex flex-col min-w-0" style={{ background: "var(--bg)" }}>
          <div className="agent-topbar">
            <Button
              type="text"
              className="md:hidden"
              style={{ padding: "4px 8px" }}
              icon={<MenuOutlined />}
              onClick={() => setMobileOpen(true)}
            />
            <Select
              showSearch
              placeholder="选择标的（对话上下文将绑定该公司）"
              style={{ width: 280, maxWidth: "58vw" }}
              value={companyId}
              onChange={onCompanyChange}
              optionFilterProp="label"
              options={companies.map((c) => ({
                value: c.id,
                label: `${c.name}（${c.ticker}）`,
              }))}
            />
            <Tag color={cfg?.hasKey ? "green" : "orange"} style={{ marginInlineEnd: 0 }}>
              {cfg?.hasKey
                ? `API 已配置（${cfg.source === "env" ? "环境变量" : "页面配置"}）`
                : "未配置 API"}
            </Tag>
            <div className="flex-1" />
            {activeHistory && (
              <Text type="secondary" style={{ fontSize: 12 }} className="hidden sm:inline">
                {activeHistory.count} 条历史消息
              </Text>
            )}
          </div>

          {cfg && !cfg.hasKey && (
            <div style={{ padding: "12px 20px 0" }}>
              <Alert
                type="warning"
                showIcon
                message="LLM API 未配置，智能体暂不可用"
                description="点击右上角「API 配置」填写 OpenAI 兼容接口的 Base URL / API Key / Model（如 DeepSeek：https://api.deepseek.com，模型 deepseek-v4-flash）。公告采集与看板不受影响。"
              />
            </div>
          )}

          <div className="agent-messages">
            <div className="agent-messages-inner">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className="chat-row"
                  style={{
                    display: "flex",
                    justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                    marginBottom: 12,
                  }}
                >
                  <div
                    className={`chat-bubble ${
                      m.role === "user" ? "chat-bubble-user" : "chat-bubble-agent"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div
                  className="chat-row"
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}
                >
                  <Spin size="small" />
                  <Text type="secondary">智能体思考中…</Text>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="agent-composer">
            <div className="agent-composer-inner">
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  companyId
                    ? "例如：帮我拉取近 30 天公告；分析这些公告的预期差；对我的 g1、ke 假设有什么影响？"
                    : "请先选择标的"
                }
                autoSize={{ minRows: 2, maxRows: 5 }}
                disabled={!companyId || sending}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sending}
                  disabled={!companyId}
                  onClick={handleSend}
                >
                  发送
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>

      <Modal
        title="LLM API 配置（OpenAI 兼容）"
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        onOk={saveConfig}
        confirmLoading={cfgSaving}
        okText="保存"
        cancelText="取消"
      >
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          留空的字段保持原值。密钥仅保存在服务端，页面不回显明文。
          {cfg?.hasKey && cfg.source === "db" && (
            <div>
              当前密钥：<code>{cfg.keyMasked}</code>
            </div>
          )}
          {cfg?.source === "env" && (
            <div>
              当前使用环境变量中的密钥（<code>{cfg.keyMasked}</code>），页面配置仅在环境变量缺失时生效。
            </div>
          )}
        </Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[
              {
                pattern: /^https?:\/\/.+/,
                message: "需以 http(s):// 开头",
              },
            ]}
          >
            <Input placeholder="https://api.deepseek.com" />
          </Form.Item>
          <Form.Item name="model" label="Model">
            <Input placeholder="deepseek-v4-flash" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key（留空保持原值）">
            <Input.Password placeholder="sk-…" autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
