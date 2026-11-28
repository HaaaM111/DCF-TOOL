import "server-only";

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getSessionUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tickerSchema } from "@/lib/validation";

export type CompanyRouteProps = { params: Promise<{ ticker: string }> };

export const requireCompany = cache(async (ticker: string) => {
  const parsed = tickerSchema.safeParse(ticker);
  if (!parsed.success) notFound();

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await getSessionUserFromToken(token);
  if (!user) notFound();

  const company = await prisma.company.findFirst({
    where: {
      ticker: parsed.data,
      ...(user.role === "admin" ? {} : { userId: user.id }),
    },
    select: { id: true, ticker: true, name: true },
  });
  if (!company) notFound();

  return company;
});
