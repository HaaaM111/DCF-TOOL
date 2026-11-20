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
import { terminalPalette } from "@/lib/terminal-palette";
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
const ThemeContext = createContext<ThemeCtx>({ mode: "light", toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

function buildTheme(mode: ThemeMode) {
  const isDark = mode === "dark";
  const palette = terminalPalette[mode];
  const fieldBackground = palette.field;
  const field = {
    colorBgContainer: fieldBackground,
    activeBorderColor: palette.accentHover,
    hoverBorderColor: palette.divider,
    activeShadow: "none",
    errorActiveShadow: "none",
    warningActiveShadow: "none",
  };
  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: palette.accent,
      colorPrimaryHover: palette.accentHover,
      colorSuccess: palette.positive,
      colorError: palette.negative,
      colorWarning: palette.warning,
      colorInfo: palette.link,
      borderRadius: 6,
      borderRadiusLG: 6,
      controlHeight: 36,
      controlHeightSM: 28,
      controlOutlineWidth: 0,
      fontSize: 14,
      fontFamily:
        'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
      colorBgLayout: palette.canvas,
      colorBgContainer: palette.panel,
      colorBorder: palette.line,
      colorText: palette.ink,
      colorTextSecondary: palette.muted,
      colorTextPlaceholder: palette.muted,
      colorLink: palette.link,
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
        defaultHoverBg: palette.hover,
        primaryColor: palette.onAccent,
        defaultShadow: "none",
        primaryShadow: "none",
        dangerShadow: "none",
      },
      Input: field,
      InputNumber: field,
      Select: { selectorBg: fieldBackground, activeBorderColor: palette.accentHover, activeOutlineColor: "transparent" },
      DatePicker: field,
      Table: {
        headerBg: palette.panel,
        headerColor: palette.muted,
        headerSplitColor: palette.line,
        borderColor: palette.line,
        rowHoverBg: palette.hover,
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
  const [mode, setMode] = useState<ThemeMode>("light");

  // 从 localStorage 读取偏好
  useEffect(() => {
    const saved = localStorage.getItem("dcf-theme");
    if (saved === "light" || saved === "dark") setMode(saved);
  }, []);

  // 同步到 <html> class
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [mode]);

  const toggle = () => {
    const next = mode === "light" ? "dark" : "light";
    localStorage.setItem("dcf-theme", next);
    setMode(next);
  };

  return (
    <ThemeContext.Provider value={{ mode, toggle }}>
      <ConfigProvider locale={zhCN} theme={buildTheme(mode)}><TerminalInteractions/>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
