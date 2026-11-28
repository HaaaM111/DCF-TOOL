import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "vi_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const requestUsers = new WeakMap<object, { id: string; role: string }>();

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, expectedHex] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: tokenDigest(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function getSessionUser(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return getSessionUserFromToken(token);
}

export async function getSessionUserFromToken(token: string | undefined) {
  if (!token || token.length > 128) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenDigest(token) },
    select: { user: { select: { id: true, email: true, role: true } }, expiresAt: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { tokenHash: tokenDigest(token) } });
    return null;
  }
  return session.user;
}

export function sessionCookieOptions(expiresAt: Date) {
  // 生产默认 Secure；本地 `next start` 做 HTTP 预览时设置 ALLOW_INSECURE_COOKIE=true 才降级
  const secure =
    process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_COOKIE !== "true";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export function isSameOriginRequest(req: NextRequest, rawOrigin: string | null) {
  if (!rawOrigin) return true;
  try {
    const origin = new URL(rawOrigin);
    const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
    const protocol = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(":", "");
    return Boolean(host && origin.host === host && origin.protocol === `${protocol}:`);
  } catch {
    return false;
  }
}

export async function requireOwnedCompany(userId: string, companyId: string) {
  return prisma.company.findFirst({ where: { id: companyId, userId }, select: { id: true } });
}

export function getAuthenticatedUserId(req: NextRequest) {
  return requestUsers.get(req)?.id ?? "";
}

export function isAdministrator(req: NextRequest) {
  return requestUsers.get(req)?.role === "admin";
}

export function companyAccessWhere(req: NextRequest, companyId: string) {
  return { id: companyId, ...(isAdministrator(req) ? {} : { userId: getAuthenticatedUserId(req) }) };
}

export function attachAuthenticatedUser(req: NextRequest, user: { id: string; role: string }) {
  requestUsers.set(req, user);
}
