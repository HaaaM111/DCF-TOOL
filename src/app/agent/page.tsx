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
  Card,
  Select,
  Button,
  Space,
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
  ArrowLeftOutlined,
  SendOutlined,
  SettingOutlined,
  RobotOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";

const { Title, Paragraph, Text } = Typography;

/** 历史为空时的默认欢迎语 */
const DEFAULT_WELCOME =
  "你好，我是公告智能体。先在上方选择标的，之后我会基于该公司的 DCF 假设与已入库公告信号回答问题；需要时你也可以让我重新拉取或分析公告。";

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
  const router = useRouter();
  const { message } = App.useApp();

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState<string>();
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: DEFAULT_WELCOME },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [cfg, setCfg] = useState<CfgState | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [form] = Form.useForm();

  const loadCompanies = useCallback(async () => {
    try {
      const res = await fetch("/api/companies", { cache: "no-store" });
      const json = await res.json();
      setCompanies(json.companies ?? []);
    } catch {
      message.error("加载标的列表失败");
    }
  }, [message]);

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
    loadConversations(v);
  };

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
        saveConversations([{ role: "user", content: text }, { role: "assistant", content: guide }]);
        return;
      }
      if (json.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: json.reply }]);
        saveConversations([
          { role: "user", content: text },
          { role: "assistant", content: json.reply },
        ]);
      } else if (json.error) {
        message.error(json.error);
      }
    } catch {
      message.error("请求失败，请稍后重试");
    } finally {
      setSending(false);
    }
  };

  /** 快捷按钮：直接触发同步（不经模型），完成后追加一条说明 */
  const handleQuickSync = async () => {
    if (!companyId) {
      message.warning("请先选择标的");
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch(`/api/announcements/${companyId}/sync?days=30`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        message.error(json.error ?? "同步失败");
        return;
      }
      const note = `已重新拉取公告：共 ${json.fetched} 条，新增 ${json.added} 条（失败 ${json.failed?.length ?? 0} 条）。需要我分析这些公告吗？`;
      setMessages((prev) => [...prev, { role: "assistant", content: note }]);
      saveConversations([{ role: "assistant", content: note }]);
      message.success("公告同步完成");
    } catch {
      message.error("同步请求失败");
    } finally {
      setSyncing(false);
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

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="brand-header px-6 py-3 flex items-center justify-between">
        <div>
          <Title level={4} style={{ color: "#fff", margin: 0 }}>
            <RobotOutlined className="mr-2" />
            智能体对话
          </Title>
          <div className="text-xs text-blue-100">
            绑定标的 · 基于 DCF 假设与公告信号问答 · 可要求重新拉取公告
          </div>
        </div>
        <Space>
          <Tag color={cfg?.hasKey ? "green" : "orange"}>
            {cfg?.hasKey
              ? `API 已配置（${cfg.source === "env" ? "环境变量" : "页面配置"}）`
              : "未配置 API"}
          </Tag>
          <Button
            icon={<SettingOutlined />}
            onClick={openConfig}
            className="header-btn"
          >
            API 配置
          </Button>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => router.push("/dashboard")}
            className="header-btn"
          >
            返回看板
          </Button>
        </Space>
      </div>

      <div className="p-6">
        <Card className="mb-4">
          <Space wrap>
            <Select
              showSearch
              placeholder="选择标的（对话上下文将绑定该公司）"
              style={{ width: 300 }}
              value={companyId}
              onChange={onCompanyChange}
              optionFilterProp="label"
              options={companies.map((c) => ({
                value: c.id,
                label: `${c.name}（${c.ticker}）`,
              }))}
            />
            <Button
              icon={<SyncOutlined />}
              loading={syncing}
              onClick={handleQuickSync}
            >
              重新拉取近 30 天公告
            </Button>
          </Space>
        </Card>

        {cfg && !cfg.hasKey && (
          <Alert
            className="mb-4"
            type="warning"
            showIcon
            message="LLM API 未配置，智能体暂不可用"
            description="点击右上角「API 配置」填写 OpenAI 兼容接口的 Base URL / API Key / Model（如 DeepSeek：https://api.deepseek.com，模型 deepseek-v4-flash）。公告采集与看板不受影响。"
          />
        )}

        <Card className="chat-card" style={{ maxWidth: 860, margin: "0 auto" }}>
          <div className="chat-body" style={{ minHeight: 420, maxHeight: 560, overflowY: "auto" }}>
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
                  className={m.role === "user" ? "chat-bubble-user" : "chat-bubble-agent"}
                  style={{
                    maxWidth: "75%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 14,
                    lineHeight: 1.6,
                    background: m.role === "user" ? "#1677ff" : "#f5f5f5",
                    color: m.role === "user" ? "#fff" : "#333",
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="chat-row" style={{ marginBottom: 12 }}>
                <Spin size="small" className="mr-2" />
                <Text type="secondary">智能体思考中…</Text>
              </div>
            )}
          </div>

          <div className="chat-input" style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
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
        </Card>
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
