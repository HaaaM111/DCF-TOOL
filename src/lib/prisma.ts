import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaClient as BasePrismaClient } from "@/generated/prisma-base/client";

/**
 * 将 SQLite 连接串中的相对路径（file:./prisma/xxx.db）基于进程工作目录
 * 解析为绝对路径。Prisma 6 运行时对 SQLite 相对路径解析不可靠
 * （报 Error code 14: Unable to open the database file），
 * 故统一在构造 Client 前显式转换；环境变量保持相对路径便于跨机部署。
 */
function resolveSqliteUrl(url: string | undefined): string | undefined {
  if (!url || !url.startsWith("file:")) return url;
  const [head, query] = url.slice(5).split("?");
  if (!head.startsWith(".")) return url; // 已是绝对路径
  const abs = path.resolve(process.cwd(), head).replace(/\\/g, "/");
  return query ? `file:${abs}?${query}` : `file:${abs}`;
}

/**
 * 双数据库客户端单例
 * - prisma：用户库（assumption / valuationReport / priceSnapshot / timelineEntry /
 *          peerValuation / historicalValuation / validationResult / companySnapshot）
 * - prismaBase：基准库（company 公司档案，只读）
 * 开发环境下复用同一个实例，避免 Next.js HMR 导致连接耗尽。
 */
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
