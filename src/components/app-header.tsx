"use client";

import { Button, Dropdown } from "antd";
import {
  BulbFilled,
  BulbOutlined,
  DesktopOutlined,
} from "@ant-design/icons";
import { useRouter, usePathname } from "next/navigation";
import { useTheme } from "@/app/providers";
import type { ThemeMode } from "@/app/providers";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { key: "/", label: "首页" },
  { key: "/dashboard", label: "估值看板" },
  { key: "/announcements", label: "公告中心" },
  { key: "/agent", label: "智能体对话" },
];

const THEME_OPTIONS: { key: ThemeMode; label: string; icon: ReactNode }[] = [
  { key: "system", label: "跟随系统", icon: <DesktopOutlined /> },
  { key: "light", label: "浅色模式", icon: <BulbOutlined /> },
  { key: "dark", label: "深色模式", icon: <BulbFilled /> },
];

interface AppHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  fluid?: boolean;
}

export default function AppHeader({
  title,
  subtitle,
  actions,
  children,
  fluid = false,
}: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { mode, setMode } = useTheme();

  const activeKey = NAV_ITEMS.find((n) =>
    n.key === "/" ? pathname === "/" : pathname.startsWith(n.key),
  )?.key;
  const visibleNavItems = pathname === "/" ? NAV_ITEMS.filter((n) => n.key === "/") : NAV_ITEMS;

  const currentTheme =
    THEME_OPTIONS.find((t) => t.key === mode) ?? THEME_OPTIONS[0];

  return (
    <div className={`app-shell${fluid ? " fluid" : ""}${pathname === "/" ? " home-shell" : ""}`}>
      <aside className="app-side">
        <div className="side-brand">
          <strong>ValueInsight</strong>
        </div>

        <nav className="side-nav">
          {visibleNavItems.map((n) => (
            <a
              key={n.key}
              className={activeKey === n.key ? "active" : ""}
              aria-current={activeKey === n.key ? "page" : undefined}
              href={n.key}
              onClick={(e) => {
                e.preventDefault();
                router.push(n.key);
              }}
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="side-source">
          <Dropdown
            menu={{
              items: THEME_OPTIONS,
              selectable: true,
              selectedKeys: [mode],
              onClick: ({ key }) => setMode(key as ThemeMode),
            }}
            trigger={["click"]}
          >
            <Button
              size="small"
              type="text"
              icon={currentTheme.icon}
              style={{ marginBottom: 8, padding: "0 8px" }}
            >
              {currentTheme.label}
            </Button>
          </Dropdown>
          <div>iFinD · 东财 · 腾讯</div>
        </div>
      </aside>

      <main className="app-main">
        {fluid ? (
          children
        ) : (
          <>
            <header className="page-heading">
              <div>
                <h1>{title}</h1>
                {subtitle && <p>{subtitle}</p>}
              </div>
              {actions && <div className="heading-actions">{actions}</div>}
            </header>
            {children}
          </>
        )}
      </main>
    </div>
  );
}
