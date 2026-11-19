"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function ReportError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [detail, setDetail] = useState("");

  useEffect(() => {
    setDetail(error?.message ?? "");
    console.error("report page error:", error);
  }, [error]);

  return (
    <div className="app-shell">
      <main className="app-main" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <div className="auth-panel" style={{ maxWidth: 520, margin: 0 }}>
          <p className="auth-label">REPORT</p>
          <h1>这页暂时打不开</h1>
          <p className="auth-intro">
            报告页在计算途中出错了，通常是某个标的的假设参数无法通过校验。可以重试，或回看板换一个标的。
          </p>
          {detail ? (
            <p className="auth-hint" style={{ wordBreak: "break-word" }}>
              错误信息：{detail}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button type="button" className="auth-submit" style={{ flex: 1 }} onClick={() => reset()}>
              重新加载
            </button>
            <button
              type="button"
              className="auth-submit"
              style={{ flex: 1, background: "transparent", color: "var(--ink)", border: "1px solid var(--line-strong)" }}
            >
              <Link href="/dashboard" style={{ color: "inherit", textDecoration: "none" }}>
                返回看板
              </Link>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
