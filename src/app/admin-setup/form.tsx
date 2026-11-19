"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BrandLogo from "@/components/brand-logo";

export default function AdminSetupForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/admin-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "初始化失败");
      router.replace("/home");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "初始化失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <BrandLogo className="auth-brand" href="/" label="ValueInsight 首页" />
      <section className="auth-panel">
        <p className="auth-label">ADMIN ACCOUNT SETUP</p>
        <h1>设置管理员密码</h1>
        <p className="auth-intro">为管理员账户创建一个至少 10 位的密码。</p>
        <form onSubmit={submit}>
          <label htmlFor="admin-password">新密码</label>
          <input id="admin-password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy || !token}>{busy ? "正在设置…" : "设置密码并登录"}<span aria-hidden="true">↗</span></button>
        </form>
        {!token && <p className="auth-error" role="alert">缺少初始化令牌，请使用完整的初始化链接。</p>}
      </section>
      <p className="auth-footnote">初始化链接只能使用一次，并会在 24 小时后失效</p>
    </main>
  );
}
