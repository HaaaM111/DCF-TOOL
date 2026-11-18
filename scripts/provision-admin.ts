import path from "node:path";
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaClient as BaseClient } from "../src/generated/prisma-base/client";

const scrypt = promisify(scryptCallback);
const root = path.resolve(__dirname, "..");
const sqlite = (...parts: string[]) => `file:${path.join(root, ...parts).replace(/\\/g, "/")}`;
const prisma = new PrismaClient({ datasources: { db: { url: sqlite("prisma", "user.db") } } });
const prismaBase = new BaseClient({ datasources: { db: { url: sqlite("prisma", "baseline.db") } } });

async function makePasswordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("用法：npx tsx scripts/provision-admin.ts <email>");
  }

  const current = await prisma.user.findUnique({ where: { email } });
  if (current) {
    if (current.role !== "admin") await prisma.user.update({ where: { id: current.id }, data: { role: "admin" } });
    console.log(`已将现有账户 ${email} 设为管理员。请使用该账户原密码登录。`);
    return;
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const randomPassword = randomBytes(48).toString("base64url");
  const passwordHash = await makePasswordHash(randomPassword);
  const companies = await prismaBase.company.findMany();

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        role: "admin",
        setupTokenHash: tokenHash,
        setupTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const seed = companies.map((company) => {
      const { id, createdAt, updatedAt, ...fields } = company;
      void id;
      void createdAt;
      void updatedAt;
      return { ...fields, id: randomUUID(), userId: user.id };
    });
    if (seed.length) await tx.company.createMany({ data: seed });
  });

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  console.log("管理员账户已创建。请通过此一次性链接设置密码（24 小时内有效）：");
  console.log(`${baseUrl}/admin-setup?token=${token}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "管理员账号创建失败");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await prismaBase.$disconnect();
  });
