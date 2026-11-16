"use client";

import { memo, useEffect, useState, useCallback, useRef } from "react";
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

const DEFAULT_WELCOME = "请先选择标的";

interface HistoryItem {
  company: CompanyOption;
  lastAt: string;
  lastContent: string;
  count: number;
}

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

function previewText(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 30);
}

function buildBindMessage(name: string, ticker: string): string {
  return `已绑定标的：${name}（${ticker}）`;
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

const ChatMessages = memo(function ChatMessages({
  messages,
  sending,
}: {
  messages: ChatMsg[];
  sending: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  return (
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
  );
});

function Composer({
  companyId,
  sending,
  onSend,
}: {
  companyId?: string;
  sending: boolean;
  onSend: (text: string) => void;
}) {
  const [input, setInput] = useState("");

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
  };

  return (
    <div className="agent-composer">
      <div className="agent-composer-inner">
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={companyId ? "输入指令" : "请先选择标的"}
          autoSize={{ minRows: 2, maxRows: 5 }}
          disabled={!companyId || sending}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={sending}
            disabled={!companyId}
            onClick={submit}
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AgentPage() {
  const { message } = App.useApp();

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState<string>();
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: DEFAULT_WELCOME },
  ]);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [cfg, setCfg] = useState<CfgState | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [form] = Form.useForm();


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

  const newChat = () => {
    setCompanyId(undefined);
    setMessages([{ role: "assistant", content: DEFAULT_WELCOME }]);
    setMobileOpen(false);
  };

  const handleSend = async (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return;
    if (!companyId) {
      message.warning("请先选择标的");
      return;
    }
    const chatHistory = [...messages, { role: "user" as const, content: text }];
    setMessages(chatHistory);
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
          "未配置 LLM API。请点击顶部「API 配置」填入 Base URL / API Key / Model 后再试。";
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
    <AppHeader title="智能体对话" fluid>
      <div className="agent-main">
        {/* 移动端遮罩 */}
        {mobileOpen && (
          <div
            className="absolute inset-0 z-20 md:hidden"
            style={{ background: "rgba(20, 28, 24, 0.45)" }}
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* 左侧：历史记录 */}
        <aside
          className={`agent-sidebar fixed z-30 top-0 bottom-0 left-0 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="p-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <Button block type="primary" ghost icon={<PlusOutlined />} onClick={newChat}>
              新对话
            </Button>
          </div>
          <div
            className="px-4 pt-3 pb-1"
            style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.04em" }}
          >
            历史对话
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2">
            {history.length === 0 ? (
              <div
                className="text-center py-10 px-3"
                style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.8 }}
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
                      style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
                    >
                      {it.company.name}
                      <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}>
                        {"  "}
                        {it.company.ticker}
                      </span>
                    </span>
                    <span
                      className="shrink-0"
                      style={{ fontSize: 11, color: "var(--muted)" }}
                    >
                      {relTime(it.lastAt)}
                    </span>
                  </div>
                  <div
                    className="truncate mt-1"
                    style={{ fontSize: 12, color: "var(--body)" }}
                  >
                    {previewText(it.lastContent)}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* 右侧：对话区 */}
        <main className="flex-1 flex flex-col min-w-0" style={{ background: "var(--canvas)" }}>
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
              placeholder="选择标的"
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
            <Button icon={<SettingOutlined />} onClick={openConfig}>
              API 配置
            </Button>
          </div>

          {cfg && !cfg.hasKey && (
            <div style={{ padding: "12px 20px 0" }}>
              <Alert
                type="warning"
                showIcon
                message="LLM API 未配置，智能体暂不可用"
              />
            </div>
          )}

          <ChatMessages messages={messages} sending={sending} />

          <Composer companyId={companyId} sending={sending} onSend={handleSend} />
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
    </AppHeader>
  );
}
