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
      colorPrimary: "#171717",
      colorSuccess: "#555555",
      colorError: "#555555",
      colorWarning: "#777777",
      colorInfo: "#333333",
      borderRadius: 5,
      fontFamily:
        'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      colorBgLayout: "#ffffff",
      colorBgContainer: "#ffffff",
      colorBorder: "#d9d9d9",
      colorText: "#202020",
      colorTextSecondary: "#707070",
    },
    components: {
      Card: {
        borderRadiusLG: 5,
        boxShadowTertiary: "none",
      },
      Table: {
        headerBg: "#f5f5f5",
        headerColor: "#707070",
        rowHoverBg: "#f2f2f2",
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
  const mode: ThemeMode = "light";
  const resolvedMode: ResolvedMode = "light";

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    localStorage.setItem(STORAGE_KEY, "light");
  }, []);

  return (
      <ThemeContext.Provider value={{ mode, resolvedMode, setMode: () => {} }}>
      <ConfigProvider locale={zhCN} theme={buildTheme(resolvedMode)}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
