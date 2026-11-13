import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authConfig, SESSION_COOKIE, verifySession } from "@/lib/session";
import AppShell from "@/components/app-shell";

export default async function TerminalLayout({ children }: { children: React.ReactNode }) {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const config = authConfig();
  if (!config || !verifySession(session, config)) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
