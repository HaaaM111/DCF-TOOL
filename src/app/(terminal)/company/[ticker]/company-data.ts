import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { tickerSchema } from "@/lib/validation";

export type CompanyRouteProps = { params: Promise<{ ticker: string }> };

export const requireCompany = cache(async (ticker: string) => {
  const parsed = tickerSchema.safeParse(ticker);
  if (!parsed.success) notFound();

  const company = await prisma.company.findUnique({
    where: { ticker: parsed.data },
    select: { id: true, ticker: true, name: true },
  });
  if (!company) notFound();

  return company;
});
