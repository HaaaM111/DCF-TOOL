import { PrismaClient } from "@/generated/prisma/client";
import { PrismaClient as BasePrismaClient } from "@/generated/prisma-base/client";

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
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

export const prismaBase =
  globalForPrisma.prismaBase ??
  new BasePrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaBase = prismaBase;
}
