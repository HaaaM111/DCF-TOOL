"use client";

import {
  ConfigProvider,
  App as AntdApp,
  theme as antdTheme,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import TerminalInteractions from "@/components/terminal-interactions";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

dayjs.locale("zh-cn");

// 主题切换上下文
type ThemeMode = "light" | "dark";
interface ThemeCtx {
  mode: ThemeMode;
  toggle: () => void;
}
const ThemeContext = createContext<ThemeCtx>({ mode: "dark", toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

function buildTheme(mode: ThemeMode) {
  const isDark = mode === "dark";
  const fieldBackground = isDark ? "#0b0e14" : "#f8fafc";
  const field = {
    colorBgContainer: fieldBackground,
    activeBorderColor: "#3b82f6",
    hoverBorderColor: isDark ? "#526276" : "#94a3b8",
    activeShadow: "none",
    errorActiveShadow: "none",
    warningActiveShadow: "none",
  };
  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: "#2563eb",
      colorPrimaryHover: "#3b82f6",
      colorSuccess: isDark ? "#34d399" : "#047857",
      colorError: isDark ? "#fb7185" : "#be123c",
      colorWarning: "#F59E0B",
      colorInfo: "#3b82f6",
      borderRadius: 6,
      borderRadiusLG: 6,
      controlHeight: 36,
      controlHeightSM: 28,
      controlOutlineWidth: 0,
      fontSize: 14,
      fontFamily:
        'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
      colorBgLayout: isDark ? "#0b0e14" : "#F8FAFC",
      colorBgContainer: isDark ? "#151a23" : "#FFFFFF",
      colorBorder: isDark ? "#2a3441" : "#E2E8F0",
      colorText: isDark ? "#e2e8f0" : "#0f172a",
      colorTextSecondary: isDark ? "#8b9eb0" : "#64748B",
      colorTextPlaceholder: isDark ? "#8192a3" : "#64748b",
      colorLink: isDark ? "#60a5fa" : "#2563eb",
    },
    components: {
      Card: {
        headerHeight: 40,
        headerHeightSM: 36,
        headerFontSize: 14,
        headerFontSizeSM: 14,
        headerPadding: 14,
        headerPaddingSM: 12,
        bodyPadding: 14,
        bodyPaddingSM: 12,
        boxShadowTertiary: "none",
      },
      Button: {
        defaultBg: "transparent",
        defaultHoverBg: isDark ? "#1e2533" : "#edf2f8",
        primaryColor: "#ffffff",
        defaultShadow: "none",
        primaryShadow: "none",
        dangerShadow: "none",
      },
      Input: field,
      InputNumber: field,
      Select: { selectorBg: fieldBackground, activeBorderColor: "#3b82f6", activeOutlineColor: "transparent" },
      DatePicker: field,
      Table: {
        headerBg: isDark ? "#151a23" : "#f1f5f9",
        headerColor: isDark ? "#8b9eb0" : "#475569",
        headerSplitColor: isDark ? "#2a3441" : "#e2e8f0",
        borderColor: isDark ? "#2a3441" : "#e2e8f0",
        rowHoverBg: isDark ? "#1e2533" : "#edf2f8",
        cellPaddingBlock: 8,
        cellPaddingBlockMD: 8,
        cellPaddingBlockSM: 8,
        cellPaddingInline: 12,
        cellPaddingInlineMD: 12,
        cellPaddingInlineSM: 12,
      },
      Tag: {
        borderRadiusSM: 4,
      },
    },
  };
}

export default function Providers({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("dark");

  // 从 localStorage 读取偏好
  useEffect(() => {
    const saved = localStorage.getItem("dcf-theme") as ThemeMode | null;
    if (saved === "light" || saved === "dark") setMode(saved);
  }, []);

  // 同步到 <html> class
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("dcf-theme", mode);
  }, [mode]);

  const toggle = () => setMode((m) => (m === "light" ? "dark" : "light"));

  return (
    <ThemeContext.Provider value={{ mode, toggle }}>
      <ConfigProvider locale={zhCN} theme={buildTheme(mode)}><TerminalInteractions/>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
