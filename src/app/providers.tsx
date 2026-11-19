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

export type ThemeMode = "light" | "dark" | "system";
type ResolvedMode = "light" | "dark";

interface ThemeCtx {
  mode: ThemeMode;
  resolvedMode: ResolvedMode;
  setMode: (m: ThemeMode) => void;
}
const ThemeContext = createContext<ThemeCtx>({
  mode: "light",
  resolvedMode: "light",
  setMode: () => {},
});
export const useTheme = () => useContext(ThemeContext);

/**
 * Miranda — old-world broadsheet.
 * Parchment #e2dedb / Bone cream #cdc6be / Ink #1d1d1b / Charcoal #69645f / Ember #c03f13.
 * The dark set keeps the same warm hue family and only flips the value ladder, so a
 * light<dark switch reads as dimming the lamp instead of a colour jump.
 */
function buildTheme(mode: ResolvedMode) {
  const isDark = mode === "dark";
  const palette = isDark
    ? {
        primary: "#ece7de",
        success: "#6f9a78",
        error: "#cf6a4c",
        warning: "#d5613c",
        info: "#a49b90",
        layout: "#1c1b19",
        container: "#262421",
        elevated: "#2b2925",
        border: "#3b3733",
        borderSecondary: "#332f2b",
        text: "#ece7de",
        textSecondary: "#a49b90",
        tableHead: "#2e2b27",
        rowHover: "#302d29",
        fill: "#2e2b27",
      }
    : {
        primary: "#1d1d1b",
        success: "#3f6b4f",
        error: "#b0452b",
        warning: "#c03f13",
        info: "#6b655e",
        layout: "#e2dedb",
        container: "#ece7e1",
        elevated: "#f1ece6",
        border: "#cdc6be",
        borderSecondary: "#d8d1c8",
        text: "#1d1d1b",
        textSecondary: "#6b655e",
        tableHead: "#ded7cd",
        rowHover: "#e6e0d8",
        fill: "#ded7cd",
      };

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: palette.primary,
      colorSuccess: palette.success,
      colorError: palette.error,
      colorWarning: palette.warning,
      colorInfo: palette.info,
      colorBgLayout: palette.layout,
      colorBgContainer: palette.container,
      colorBgElevated: palette.elevated,
      colorBorder: palette.border,
      colorBorderSecondary: palette.borderSecondary,
      colorText: palette.text,
      colorTextSecondary: palette.textSecondary,
      colorFillSecondary: palette.fill,
      borderRadius: 4,
      fontFamily:
        'Georgia, "Times New Roman", "Songti SC", "Noto Serif SC", "SimSun", "Source Han Serif SC", serif',
    },
    components: {
      Card: {
        borderRadiusLG: 2,
        boxShadowTertiary: "none",
      },
      Table: {
        headerBg: palette.tableHead,
        headerColor: palette.textSecondary,
        rowHoverBg: palette.rowHover,
      },
      Tag: {
        borderRadiusSM: 2,
      },
      Button: {
        fontWeight: 400,
      },
      Input: {
        borderRadius: 2,
      },
    },
  };
}

const STORAGE_KEY = "dcf-theme";

export default function Providers({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>("light");

  // Restore an explicitly saved choice; first visits stay on the light broadsheet.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "system") setModeState(saved);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved: ResolvedMode =
        mode === "system" ? (media.matches ? "dark" : "light") : mode;
      root.classList.toggle("dark", resolved === "dark");
      root.style.colorScheme = resolved;
      setResolvedMode(resolved);
    };
    apply();
    if (mode === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
  }, [mode]);

  const setMode = (next: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, next);
    setModeState(next);
  };

  return (
    <ThemeContext.Provider value={{ mode, resolvedMode, setMode }}>
      <ConfigProvider locale={zhCN} theme={buildTheme(resolvedMode)}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
