import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const idSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);

export default async function LegacyReportPage({ params }: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();

  const company = await prisma.company.findUnique({ where: { id: id.data }, select: { ticker: true } });
  if (!company) notFound();

  redirect("/company/" + encodeURIComponent(company.ticker));
}
