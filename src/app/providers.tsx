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
  mode: "system",
  resolvedMode: "light",
  setMode: () => {},
});
export const useTheme = () => useContext(ThemeContext);

function buildTheme(mode: ResolvedMode) {
  const isDark = mode === "dark";
  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: "#315e49",
      colorSuccess: "#315e49",
      colorError: "#9c5a4e",
      colorWarning: "#a8a08c",
      colorInfo: "#315e49",
      borderRadius: 5,
      fontFamily:
        'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      colorBgLayout: isDark ? "#151b18" : "#f7f8f6",
      colorBgContainer: isDark ? "#222b26" : "#FFFFFF",
      colorBorder: isDark ? "#333d38" : "#d9ded9",
      colorText: isDark ? "#e4e9e6" : "#202c26",
      colorTextSecondary: isDark ? "#828d86" : "#77817a",
    },
    components: {
      Card: {
        borderRadiusLG: 5,
        boxShadowTertiary: "none",
      },
      Table: {
        headerBg: isDark ? "#151b18" : "#f7f8f6",
        headerColor: isDark ? "#828d86" : "#77817a",
        rowHoverBg: isDark ? "#2b3d34" : "#e2e9e3",
      },
      Tag: {
        borderRadiusSM: 4,
      },
      Button: {
        fontWeight: 500,
      },
    },
  };
}

const STORAGE_KEY = "dcf-theme";

export default function Providers({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mql.matches);
    const handleChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener("change", handleChange);

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      setMode(saved);
    }

    return () => mql.removeEventListener("change", handleChange);
  }, []);

  const resolvedMode: ResolvedMode =
    mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    const root = document.documentElement;
    if (resolvedMode === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode, resolvedMode]);

  return (
    <ThemeContext.Provider value={{ mode, resolvedMode, setMode }}>
      <ConfigProvider locale={zhCN} theme={buildTheme(resolvedMode)}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
