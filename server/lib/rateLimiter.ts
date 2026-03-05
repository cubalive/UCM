import { incr, isRedisConnected } from "./redis";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory fallback store (used when Redis is unavailable)
const store = new Map<string, RateLimitEntry>();

setInterval(() => {
  const now = Date.now();
  store.forEach((entry, key) => {
    if (now > entry.resetAt) store.delete(key);
  });
}, 60_000);

/**
 * Distributed rate limiter backed by Upstash Redis.
 * Falls back to in-memory when Redis is not connected.
 *
 * Uses Redis INCR + EXPIRE for atomic, distributed counting across
 * multiple API instances. Safe for multi-instance Railway deployments.
 */
export async function checkRateLimitDistributed(
  identifier: string,
  maxRequests: number = 30,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  if (!isRedisConnected()) {
    return checkRateLimit(identifier, maxRequests, windowSeconds);
  }

  try {
    const key = `rl:${identifier}`;
    const count = await incr(key, windowSeconds);

    if (count > maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: windowSeconds * 1000,
      };
    }

    return {
      allowed: true,
      remaining: maxRequests - count,
      retryAfterMs: 0,
    };
  } catch {
    // Redis error — fall back to in-memory
    return checkRateLimit(identifier, maxRequests, windowSeconds);
  }
}

/**
 * In-memory rate limiter (original implementation).
 * Used as fallback when Redis is unavailable, and for callers
 * that need synchronous rate limiting (WebSocket, SMS).
 */
export function checkRateLimit(
  identifier: string,
  maxRequests: number = 30,
  windowSeconds: number = 60
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const entry = store.get(identifier);

  if (!entry || now > entry.resetAt) {
    store.set(identifier, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: maxRequests - 1, retryAfterMs: 0 };
  }

  entry.count++;
  if (entry.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: entry.resetAt - now,
    };
  }

  return { allowed: true, remaining: maxRequests - entry.count, retryAfterMs: 0 };
}
