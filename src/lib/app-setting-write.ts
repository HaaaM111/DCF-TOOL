import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

type SettingsWriter = Pick<Prisma.TransactionClient, "appSetting" | "$queryRaw" | "$executeRaw">;

/** Existing SQLite archives may retain an independent required row ID alongside the unique key. */
export async function writeAppSetting(db: SettingsWriter, key: string, value: string, keepExisting = false) {
  const columns = await db.$queryRaw<{ name: string }[]>`PRAGMA table_info("AppSetting")`;
  if (!columns.some(({ name }) => name === "id")) {
    await db.appSetting.upsert({ where: { key }, create: { key, value }, update: keepExisting ? {} : { value } });
    return;
  }
  if (keepExisting) {
    await db.$executeRaw`INSERT INTO "AppSetting" ("id","key","value","updatedAt") VALUES (${randomUUID()}, ${key}, ${value}, ${Date.now()})
      ON CONFLICT("key") DO NOTHING`;
  } else {
    await db.$executeRaw`INSERT INTO "AppSetting" ("id","key","value","updatedAt") VALUES (${randomUUID()}, ${key}, ${value}, ${Date.now()})
      ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt"`;
  }
}
