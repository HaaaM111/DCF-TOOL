"use client";

import { createContext, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Drawer } from "antd";
import {
  BulbFilled, BulbOutlined, DashboardOutlined, FileAddOutlined, FileSearchOutlined, HomeOutlined, MenuFoldOutlined, MenuOutlined,
  MenuUnfoldOutlined, RobotOutlined, SettingOutlined,
} from "@ant-design/icons";
import { useTheme } from "@/app/providers";
import { companySections } from "@/app/(terminal)/company/[ticker]/sections";
import { TerminalBrand } from "./terminal-brand";
import AccountMenu from "./account-menu";
import home from "@/app/(terminal)/dashboard/home.module.css";

export const AppShellContext = createContext(false);

const navigation = [
  { href: "/dashboard", label: "首页", icon: HomeOutlined },
  { href: "/valuation/board", label: "估值看板", icon: DashboardOutlined },
  { href: "/valuation/new", label: "新增估值", icon: FileAddOutlined },
  { href: "/announcements", label: "公告中心", icon: FileSearchOutlined },
  { href: "/agent", label: "智能体对话", icon: RobotOutlined },
  { href: "/settings", label: "设置", icon: SettingOutlined },
];
const control = "inline-grid h-8 w-8 shrink-0 place-items-center rounded-md border border-terminal-line bg-transparent text-[15px] text-terminal-muted hover:bg-terminal-hover hover:text-terminal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-accent-hover";

function Navigation({ pathname, collapsed, onSelect }: { pathname: string; collapsed?: boolean; onSelect?: () => void }) {
  return <nav aria-label="主导航" className="space-y-1 px-1.5 py-3 md:px-2">
    {navigation.map(({ href, label, icon: Icon }) => {
      const active = pathname === href || pathname.startsWith(href + "/");
      return <Link key={href} href={href} onClick={onSelect} aria-current={active ? "page" : undefined}
        aria-label={label} title={collapsed ? label : undefined}
        className={`relative flex h-9 items-center gap-3 rounded-md text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-accent-hover
          ${active ? "bg-terminal-hover font-medium text-terminal-ink dark:text-white before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r-sm before:bg-terminal-accent-hover" : "text-terminal-muted hover:bg-terminal-hover hover:text-terminal-ink"}
          ${collapsed ? "justify-center" : "px-3"}`}>
        <Icon aria-hidden="true" className="shrink-0 text-base" />
        {!collapsed && <span>{label}</span>}
      </Link>;
    })}
  </nav>;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const { mode, toggle } = useTheme();
  const themeLabel = mode === "dark" ? "切换浅色" : "切换深色";
  const current = navigation.find(({ href }) => pathname === href || pathname.startsWith(href + "/"));
  const companySuffix = pathname.split("/").slice(3).join("/");
  const companyModule = Object.values(companySections).find(({ suffix }) => suffix.slice(1) === companySuffix);
  const title = current?.label ?? (pathname.startsWith("/company/")
    ? companyModule?.label ?? "标的详情"
    : pathname === "/model/edit" ? "编辑估值假设" : "估值工作台");

  const account = (showLabel = false) => <AccountMenu terminal showLabel={showLabel} className={control} />;
  const themeControl = (homeStyle = false) => <button type="button" aria-label={themeLabel} title={themeLabel}
    className={homeStyle ? undefined : control} onClick={toggle}>
    {mode === "dark" ? <BulbFilled aria-hidden="true" /> : <BulbOutlined aria-hidden="true" />}
  </button>;

  if (pathname === "/dashboard") return <AppShellContext.Provider value={true}>
    <div className={home.shell}>
      <a href="#terminal-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-terminal-surface focus:p-3">跳至内容</a>
      <header className={home.masthead}><div className={home.mastInner}>
        <Link href="/dashboard" className={home.brand}><span className={home.brandMark} aria-hidden="true">V</span>ValueInsight</Link>
        <nav aria-label="主导航" className={home.mainNav}>
          {navigation.filter(({ href }) => href !== "/valuation/new" && href !== "/settings").map(({ href, label }) =>
            <Link key={href} href={href} aria-current={href === pathname ? "page" : undefined}>{label}</Link>)}
        </nav>
        <div className={home.controls}>{account(true)}{themeControl(true)}</div>
      </div></header>
      <main id="terminal-content" tabIndex={-1}>{children}</main>
    </div>
  </AppShellContext.Provider>;

  return (
    <AppShellContext.Provider value={true}>
      <a href="#terminal-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-terminal-surface focus:p-3">跳至内容</a>
      <div className="grid min-h-dvh grid-cols-[48px_minmax(0,1fr)] bg-terminal-canvas font-sans text-terminal-ink md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]"
        style={{ "--sidebar-width": collapsed ? "64px" : "240px" } as CSSProperties}>
        <aside className="sticky top-0 h-dvh self-start overflow-y-auto border-r border-terminal-line bg-terminal-canvas md:hidden">
          <div className="flex h-14 items-center justify-center border-b border-terminal-line">
            <button type="button" aria-label="打开导航" aria-expanded={drawer} onClick={() => setDrawer(true)} className={control}>
              <MenuOutlined />
            </button>
          </div>
          <Navigation pathname={pathname} collapsed />
        </aside>
        <aside className="sticky top-0 hidden h-dvh self-start overflow-y-auto border-r border-terminal-line bg-terminal-canvas md:block">
          <div className={`flex h-14 items-center border-b border-terminal-line ${collapsed ? "justify-center" : "px-4"}`}>
            <Link href="/dashboard" aria-label="DCF 估值终端总览"><TerminalBrand compact={collapsed} /></Link>
          </div>
          <Navigation pathname={pathname} collapsed={collapsed} />
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-terminal-line bg-terminal-surface px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" aria-label={collapsed ? "展开侧栏" : "折叠侧栏"} aria-expanded={!collapsed}
                onClick={() => setCollapsed(!collapsed)} className={`${control} hidden md:inline-flex`}>
                {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </button>
              <h1 className="truncate text-sm font-semibold">{title}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {themeControl()}{account()}
            </div>
          </header>
          <main id="terminal-content" tabIndex={-1} className="min-w-0">{children}</main>
        </div>
      </div>
      <Drawer title={<TerminalBrand />} placement="left" size={240} open={drawer} onClose={() => setDrawer(false)}
        styles={{
          body: { padding: 0, background: "var(--bg)" },
          header: { background: "var(--bg)", borderBottom: "1px solid var(--border)" },
        }}>
        <Navigation pathname={pathname} onSelect={() => setDrawer(false)} />
      </Drawer>
    </AppShellContext.Provider>
  );
}
