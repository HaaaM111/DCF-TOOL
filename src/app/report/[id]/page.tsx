import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const idSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);

export default async function LegacyReportPage({ params }: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await getSessionUserFromToken(token);
  if (!user) notFound();

  const company = await prisma.company.findFirst({
    where: { id: id.data, ...(user.role === "admin" ? {} : { userId: user.id }) },
    select: { ticker: true },
  });
  if (!company) notFound();

  redirect("/company/" + encodeURIComponent(company.ticker));
}
