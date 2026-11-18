"use client";

import { useEffect, useState } from "react";
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

interface AppHeaderProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  fluid?: boolean;
}

function BrandLogo() {
  return (
    <a
      className="navbar-brand"
      href="/"
      aria-label="ValueInsight 首页"
    >
      <span className="navbar-brand-mark" aria-hidden="true">V</span>
      <span className="navbar-brand-word">ValueInsight</span>
    </a>
  );
}

function SignInIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M12 3.5h4.5v13H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 10h9m-3.5-3.5L11.5 10 8 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SignUpIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
      <circle cx="7.25" cy="6.25" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.75 17c.45-2.8 2.4-4.25 5.5-4.25 1.2 0 2.2.22 3 .67" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15 10.5v7m-3.5-3.5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
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
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle("home-interaction-mode", pathname === "/");
    return () => document.body.classList.remove("home-interaction-mode");
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const activeKey = NAV_ITEMS.find((n) =>
    n.key === "/" ? pathname === "/" : pathname.startsWith(n.key),
  )?.key;

  const toggleTheme = () => {
    setMode((mode === "dark" ? "light" : "dark") as ThemeMode);
  };

  const navigate = (path: string) => {
    setMobileOpen(false);
    router.push(path);
  };

  return (
    <div className={`app-shell${fluid ? " fluid" : ""}${pathname === "/" ? " home-shell" : ""}`}>
      <header className="navbar">
        <div className="navbar-inner">
          <div className="navbar-left">
            <BrandLogo />
            <nav className="navbar-menu" aria-label="主导航">
              {NAV_ITEMS.map((n) => (
                <a
                  key={n.key}
                  className={activeKey === n.key ? "active" : ""}
                  aria-current={activeKey === n.key ? "page" : undefined}
                  href={n.key}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(n.key);
                  }}
                >
                  {n.label}
                </a>
              ))}
            </nav>
          </div>

          <div className="navbar-right">
            <button
              type="button"
              className="navbar-btn navbar-btn-outline navbar-btn-signin"
              disabled
            >
              <SignInIcon />
              Sign In
            </button>
            <button
              type="button"
              className="navbar-btn navbar-btn-primary"
              disabled
            >
              <SignUpIcon />
              Sign Up
            </button>
            <button
              type="button"
              className="navbar-icon-btn"
              aria-label={mode === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              onClick={toggleTheme}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="4" fill="currentColor" />
                <path
                  d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            </button>

            <button
              type="button"
              className="navbar-menu-btn"
              aria-label="打开导航菜单"
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <>
          <div
            className="navbar-sheet-overlay"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="navbar-sheet" id="mobile-navigation" aria-label="移动端导航">
            <div className="navbar-sheet-head">
              <BrandLogo />
              <button
                type="button"
                className="navbar-icon-btn"
                aria-label="关闭导航菜单"
                onClick={() => setMobileOpen(false)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" />
                </svg>
              </button>
            </div>
            <nav className="navbar-sheet-nav" aria-label="移动端主导航">
              {NAV_ITEMS.map((n) => (
                <a
                  key={n.key}
                  className={activeKey === n.key ? "active" : ""}
                  aria-current={activeKey === n.key ? "page" : undefined}
                  href={n.key}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(n.key);
                  }}
                >
                  {n.label}
                </a>
              ))}
            </nav>
          </aside>
        </>
      )}

      <main className="app-main">
        {fluid ? (
          children
        ) : (
          <>
            {(title || subtitle || actions) && (
              <header className="page-heading">
                {(title || subtitle) && (
                  <div>
                    {title && <h1>{title}</h1>}
                    {subtitle && <p>{subtitle}</p>}
                  </div>
                )}
                {actions && <div className="heading-actions">{actions}</div>}
              </header>
            )}
            {children}
          </>
        )}
      </main>
    </div>
  );
}
