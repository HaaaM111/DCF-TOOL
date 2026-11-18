import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import HomeClientPage from "./client-page";
import { getSessionUserFromToken, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const user = await getSessionUserFromToken(token);
  if (!user) redirect("/sign-in");
  return <HomeClientPage />;
}
