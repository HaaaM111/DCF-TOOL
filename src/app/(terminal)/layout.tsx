import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import AppShell from "@/components/app-shell";

export default async function TerminalLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await getSessionUserFromToken(token))) redirect("/sign-in");
  return <AppShell>{children}</AppShell>;
}
