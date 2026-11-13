import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

export const SESSION_COOKIE = "__Host-valueinsight-session";
const lifetimeSeconds = 8 * 60 * 60;
export const sessionCookieOptions = {
  httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: lifetimeSeconds,
} as const;

export const loginSchema = z.strictObject({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(512),
});

export function authConfig() {
  const password = process.env.APP_ACCESS_PASSWORD;
  const secret = process.env.APP_SESSION_SECRET;
  if (!password || password.length > 512 || !secret || secret.trim().length < 32 || secret === password) return null;
  return { password, secret };
}

type AuthConfig = NonNullable<ReturnType<typeof authConfig>>;
const digest = (value: string) => createHash("sha256").update(value).digest();

export function credentialsMatch(config: AuthConfig, username: string, password: string) {
  const validPassword = timingSafeEqual(digest(config.password), digest(password));
  return username === "admin" && validPassword;
}

function signature(payload: string, config: AuthConfig) {
  return createHmac("sha256", config.secret).update("valueinsight:session:v1\0").update(digest(config.password)).update(payload).digest();
}

export function createSession(config: AuthConfig, now = Date.now()) {
  const expires = Math.floor(now / 1000) + lifetimeSeconds;
  const payload = `${expires}.${randomBytes(24).toString("base64url")}`;
  return `${payload}.${signature(payload, config).toString("base64url")}`;
}

export function verifySession(value: string | undefined, config: AuthConfig, now = Date.now()) {
  if (!value || !/^\d{10,11}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const [expires, nonce, signed] = value.split(".");
  const clock = Math.floor(now / 1000);
  if (Number(expires) <= clock || Number(expires) > clock + lifetimeSeconds) return false;
  const expected = signature(`${expires}.${nonce}`, config);
  return timingSafeEqual(Buffer.from(signed), Buffer.from(expected.toString("base64url")));
}

export function permitsRequestOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowed = (process.env.CORS_ORIGIN ?? "").split(",").map((value) => value.trim());
  return req.headers.get("sec-fetch-site") !== "cross-site"
    && (origin === null || origin === req.nextUrl.origin || allowed.includes(origin));
}

export function loginDestination(value: string | null) {
  const fallback = "/dashboard";
  if (!value || value.length > 2000 || !value.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  const base = "https://internal.invalid";
  try {
    const target = new URL(value, base);
    if (target.origin !== base || !/^\/(dashboard|valuation|company|settings|report|model|agent|announcements)(\/|$)/.test(target.pathname)
      || /%2f|%5c|%25/i.test(target.pathname)) return fallback;
    return target.pathname + target.search;
  } catch {
    return fallback;
  }
}
