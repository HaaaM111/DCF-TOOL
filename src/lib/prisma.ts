import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaClient as BasePrismaClient } from "@/generated/prisma-base/client";

function resolveSqliteUrl(url: string | undefined): string | undefined {
  if (!url || !url.startsWith("file:")) return url;
  const [head, query] = url.slice(5).split("?");
  if (!head.startsWith(".")) return url;
  const abs = path.resolve(process.cwd(), head).replace(/\\/g, "/");
  return query ? `file:${abs}?${query}` : `file:${abs}`;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaBase: BasePrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: resolveSqliteUrl(process.env.DATABASE_URL) } },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

export const prismaBase =
  globalForPrisma.prismaBase ??
  new BasePrismaClient({
    datasources: {
      db: { url: resolveSqliteUrl(process.env.BASELINE_DATABASE_URL) },
    },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaBase = prismaBase;
}
