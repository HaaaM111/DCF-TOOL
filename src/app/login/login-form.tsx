"use client";

import { useState, type FormEvent } from "react";

const field = "h-10 w-full rounded-md border border-terminal-line bg-terminal-canvas px-3 text-sm text-terminal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-accent";

export default function LoginForm({ destination, configured }: { destination: string; configured: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !configured) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "登录失败，请稍后重试");
        return;
      }
      window.location.replace(destination);
    } catch {
      setError("登录失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form method="post" action="/api/auth/login" onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="username" className="mb-1.5 block text-sm">账号</label>
        <input id="username" name="username" autoComplete="username" required maxLength={80} className={field} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm">密码</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={512} className={field} />
      </div>
      {(error || !configured) && <p role="alert" className="break-words text-sm text-[var(--neg-red)]">{error || "登录服务尚未配置"}</p>}
      <button type="submit" disabled={busy || !configured}
        className="h-10 w-full rounded-md bg-terminal-accent text-sm font-semibold text-white hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terminal-accent disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
