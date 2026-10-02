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
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

dayjs.locale("zh-cn");

// 主题切换上下文
type ThemeMode = "light" | "dark";
interface ThemeCtx {
  mode: ThemeMode;
  toggle: () => void;
}
const ThemeContext = createContext<ThemeCtx>({ mode: "light", toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

/**
 * Ant Design 主题配置（专业金融终端配色）
 * 主色：深蓝 #1E3A5F；靛蓝 #4F46E5；正向绿 #10B981；警示红 #EF4444；琥珀 #F59E0B
 */
function buildTheme(mode: ThemeMode) {
  const isDark = mode === "dark";
  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: "#4F46E5",
      colorSuccess: "#10B981",
      colorError: "#EF4444",
      colorWarning: "#F59E0B",
      colorInfo: "#1E3A5F",
      borderRadius: 8,
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      colorBgLayout: isDark ? "#0F172A" : "#F8FAFC",
      colorBgContainer: isDark ? "#1E293B" : "#FFFFFF",
      colorBorder: isDark ? "#334155" : "#E2E8F0",
      colorText: isDark ? "#F1F5F9" : "#0F172A",
      colorTextSecondary: isDark ? "#94A3B8" : "#64748B",
    },
    components: {
      Card: {
        borderRadiusLG: 12,
        boxShadowTertiary: isDark
          ? "0 1px 3px rgba(0,0,0,0.3)"
          : "0 1px 2px 0 rgba(0,0,0,0.04)",
      },
      Table: {
        headerBg: isDark ? "#0F172A" : "#F8FAFC",
        headerColor: isDark ? "#94A3B8" : "#64748B",
        rowHoverBg: isDark ? "#334155" : "#F0F7FF",
      },
      Tag: {
        borderRadiusSM: 4,
      },
    },
  };
}

export default function Providers({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("light");

  // 从 localStorage 读取偏好
  useEffect(() => {
    const saved = localStorage.getItem("dcf-theme") as ThemeMode | null;
    if (saved) setMode(saved);
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
      <ConfigProvider locale={zhCN} theme={buildTheme(mode)}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
