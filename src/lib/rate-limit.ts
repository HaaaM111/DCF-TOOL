import { NextRequest } from "next/server";

interface WindowEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, WindowEntry>();
const DEFAULT_LIMIT = 60;

export function getClientIp(req: NextRequest): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",").pop()?.trim() ?? "unknown";
  return "unknown";
}

export function checkRateLimit(
  ip: string,
  limit: number = DEFAULT_LIMIT,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || entry.resetAt <= now) {
    const resetAt = now + 60_000;
    store.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

export function cleanupRateLimitStore(): void {
  const now = Date.now();
  store.forEach((entry, ip) => {
    if (entry.resetAt <= now) store.delete(ip);
  });
}

if (typeof setInterval !== "undefined") {
  setInterval(cleanupRateLimitStore, 60_000).unref?.();
}
