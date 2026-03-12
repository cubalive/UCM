import { incr } from "./redis";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

setInterval(() => {
  const now = Date.now();
  store.forEach((entry, key) => {
    if (now > entry.resetAt) store.delete(key);
  });
}, 60_000);

function checkRateLimitInMemory(
  identifier: string,
  maxRequests: number,
  windowSeconds: number
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

/**
 * Distributed rate limiter: tries Redis first (shared across replicas),
 * falls back to in-memory if Redis is unavailable.
 */
export async function checkRateLimit(
  identifier: string,
  maxRequests: number = 30,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  try {
    const windowKey = Math.floor(Date.now() / (windowSeconds * 1000));
    const redisKey = `rl:lib:${identifier}:${windowKey}`;
    const count = await incr(redisKey, windowSeconds + 1);

    if (count > maxRequests) {
      const windowMs = windowSeconds * 1000;
      const elapsed = Date.now() % windowMs;
      const retryAfterMs = windowMs - elapsed;
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    return { allowed: true, remaining: maxRequests - count, retryAfterMs: 0 };
  } catch {
    // Redis completely failed — fall back to in-memory
    return checkRateLimitInMemory(identifier, maxRequests, windowSeconds);
  }
}
