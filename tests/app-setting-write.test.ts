import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { writeAppSetting } from "../src/lib/app-setting-write";

test("settings write works on deployed SQLite archives with a required independent ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcf-setting-test-"));
  const file = join(directory, "settings.db");
  const client = new PrismaClient({ datasources: { db: { url: "file:" + file.replaceAll("\\", "/") } } });
  try {
    await client.$executeRaw`CREATE TABLE AppSetting (id TEXT NOT NULL PRIMARY KEY, userId TEXT, key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL, updatedAt DATETIME NOT NULL)`;
    await assert.rejects(client.$executeRaw`INSERT INTO "AppSetting" ("key","value","updatedAt") VALUES ('old-path', 'first', ${Date.now()})`, /id|constraint/i);
    await client.$transaction(async (tx) => {
      await writeAppSetting(tx, "valuation", "first");
      await writeAppSetting(tx, "valuation", "keep original", true);
      assert.equal((await tx.appSetting.findUniqueOrThrow({ where: { key: "valuation" } })).value, "first");
      await writeAppSetting(tx, "valuation", "new");
    });
    const row = await client.appSetting.findUniqueOrThrow({ where: { key: "valuation" } });
    assert.equal(row.value, "new");
    assert.ok(Number.isFinite(row.updatedAt.getTime()));
  } finally {
    await client.$disconnect();
    for (const suffix of ["", "-journal", "-wal", "-shm"]) await rm(file + suffix, { force: true });
    await rmdir(directory);
  }
});
