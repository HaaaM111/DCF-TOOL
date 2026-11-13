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
    <main className="grid min-h-dvh place-items-center bg-terminal-canvas px-4 py-8 text-terminal-ink">
      <section aria-label="登录" className="w-full max-w-sm rounded-xl border border-terminal-line bg-terminal-surface p-6 sm:p-8">
        <div className="mb-6"><TerminalBrand /></div>
        <LoginForm destination={destination} configured={!!config} />
      </section>
    </main>
  );
}
