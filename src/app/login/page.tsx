import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authConfig, loginDestination, SESSION_COOKIE, verifySession } from "@/lib/session";
import { TerminalBrand } from "@/components/terminal-brand";
import LoginForm from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const destination = loginDestination(typeof next === "string" ? next : null);
  const config = authConfig();
  if (config && verifySession((await cookies()).get(SESSION_COOKIE)?.value, config)) redirect(destination);

  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] bg-terminal-canvas font-sans text-terminal-ink md:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] md:grid-rows-1">
      <section aria-label="DCF 估值终端" className="grid min-w-0 px-6 pb-8 pt-6 sm:px-10 md:grid-rows-[auto_1fr_auto] md:px-12 md:py-8 xl:px-16">
        <div><TerminalBrand /></div>
        <h1 className="mt-8 max-w-lg text-2xl font-semibold leading-snug tracking-tight md:my-12 md:self-center md:text-4xl md:leading-tight xl:text-5xl xl:leading-tight">
          AI 驱动的企业估值交叉验证系统
        </h1>
      </section>
      <section aria-label="登录" className="grid min-w-0 place-items-center border-t border-terminal-line bg-terminal-surface px-6 py-10 sm:px-10 md:border-l md:border-t-0">
        <div className="w-full max-w-[360px]">
          <LoginForm destination={destination} configured={!!config} />
        </div>
      </section>
    </main>
  );
}
