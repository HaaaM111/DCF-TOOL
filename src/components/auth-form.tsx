"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BrandLogo from "@/components/brand-logo";

export default function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const signup = mode === "signup";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${signup ? "signup" : "signin"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "暂时无法完成，请稍后重试");
      router.replace("/home");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法完成，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <BrandLogo className="auth-brand" href="/" label="ValueInsight 首页" />
      <section className="auth-panel">
        <p className="auth-label">VALUEINSIGHT ACCOUNT</p>
        <h1>{signup ? "创建你的账户" : "欢迎回来"}</h1>
        <p className="auth-intro">{signup ? "开启个人专属的投资研究空间。" : "登录以继续你的研究。"}</p>
        <form onSubmit={submit}>
          <label htmlFor="auth-email">邮箱</label>
          <input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="auth-password">密码</label>
          <input id="auth-password" name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 10 : 1} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
          {signup && <small className="auth-hint">至少 10 位。你的研究数据会与其他账户隔离。</small>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={loading}>{loading ? "请稍候…" : signup ? "Sign Up" : "Sign In"}<span aria-hidden="true">↗</span></button>
        </form>
        <p className="auth-switch">{signup ? "已有账户？" : "还没有账户？"} <Link href={signup ? "/sign-in" : "/sign-up"}>{signup ? "Sign In" : "Sign Up"}</Link></p>
      </section>
      <p className="auth-footnote">登录后进入你的专属研究工作区</p>
    </main>
  );
}
