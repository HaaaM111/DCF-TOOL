/**
 * 简易 IP 速率限制器（基于内存滑动窗口）
 * 适用于单实例部署；生产环境应替换为 Redis 实现。
 */
import { NextRequest } from "next/server";

interface WindowEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, WindowEntry>();
const DEFAULT_LIMIT = 60; // 次/分钟

/**
 * 获取客户端 IP（支持代理）
 * 优先取 X-Real-IP（nginx 设置为 $remote_addr，客户端无法伪造）；
 * 无 nginx 直连时退回 X-Forwarded-For 最后一个值（最后追加的通常是真实来源）。
 */
export function getClientIp(req: NextRequest): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",").pop()?.trim() ?? "unknown";
  return "unknown";
}

/**
 * 检查是否超出速率限制
 * @returns [是否允许, 剩余次数, 重置时间戳]
 */
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

/** 清理过期条目（防止内存泄漏） */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  store.forEach((entry, ip) => {
    if (entry.resetAt <= now) store.delete(ip);
  });
}

// 每分钟自动清理一次
if (typeof setInterval !== "undefined") {
  setInterval(cleanupRateLimitStore, 60_000).unref?.();
}
