/**
 * Distributed sliding-window rate limiter.
 * Uses Redis (Upstash) for distributed state across multiple Railway replicas.
 * Falls back to in-memory when Redis is unavailable.
 *
 * Protects sensitive endpoints (auth, billing, PHI) from brute-force & abuse.
 * Uses IP + userId composite key for authenticated routes.
 */

import type { Request, Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { incr } from "../lib/redis";

interface SlidingWindow {
  timestamps: number[];
  blockedUntil: number;
}

// In-memory fallback for when Redis is unavailable
const memWindows = new Map<string, SlidingWindow>();

// Cleanup in-memory fallback every 5 minutes
const CLEANUP_INTERVAL = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, win] of memWindows) {
    if (win.timestamps.length === 0 && win.blockedUntil < now) {
      memWindows.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

interface RateLimitConfig {
  /** Max requests in window */
  max: number;
  /** Window size in ms */
  windowMs: number;
  /** Block duration after limit exceeded (ms) */
  blockDurationMs?: number;
  /** Key extractor — defaults to IP + path */
  keyFn?: (req: Request) => string;
  /** Skip function */
  skip?: (req: Request) => boolean;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Try Redis-based rate limiting first. Falls back to in-memory if Redis is unavailable.
 */
export function rateLimiter(config: RateLimitConfig) {
  const {
    max,
    windowMs,
    blockDurationMs = windowMs,
    keyFn,
    skip,
  } = config;

  const windowSec = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction) => {
    if (skip?.(req)) return next();

    const key = keyFn
      ? keyFn(req)
      : `${getClientIp(req)}:${req.path}`;

    const redisKey = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;

    try {
      // Use Redis incr — automatically distributed across replicas
      const count = await incr(redisKey, windowSec + 1);

      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - count)));

      if (count > max) {
        const retryAfter = Math.ceil(windowMs / 1000);
        res.setHeader("Retry-After", String(retryAfter));
        res.setHeader("X-RateLimit-Remaining", "0");

        console.warn(JSON.stringify({
          event: "rate_limit_exceeded",
          key,
          ip: getClientIp(req),
          path: req.path,
          method: req.method,
          userId: (req as AuthRequest).user?.userId,
          count,
          max,
          ts: new Date().toISOString(),
        }));

        return res.status(429).json({
          message: "Too many requests. Please try again later.",
          code: "RATE_LIMITED",
          retryAfterSeconds: retryAfter,
        });
      }

      next();
    } catch {
      // Redis completely failed — fall back to in-memory sliding window
      inMemoryRateLimit(req, res, next, key, max, windowMs, blockDurationMs);
    }
  };
}

function inMemoryRateLimit(
  req: Request, res: Response, next: NextFunction,
  key: string, max: number, windowMs: number, blockDurationMs: number
) {
  const now = Date.now();
  let win = memWindows.get(key);

  if (!win) {
    win = { timestamps: [], blockedUntil: 0 };
    memWindows.set(key, win);
  }

  if (win.blockedUntil > now) {
    const retryAfter = Math.ceil((win.blockedUntil - now) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", "0");
    return res.status(429).json({
      message: "Too many requests. Please try again later.",
      code: "RATE_LIMITED",
      retryAfterSeconds: retryAfter,
    });
  }

  const cutoff = now - windowMs;
  win.timestamps = win.timestamps.filter(t => t > cutoff);

  if (win.timestamps.length >= max) {
    win.blockedUntil = now + blockDurationMs;
    const retryAfter = Math.ceil(blockDurationMs / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", "0");
    return res.status(429).json({
      message: "Too many requests. Please try again later.",
      code: "RATE_LIMITED",
      retryAfterSeconds: retryAfter,
    });
  }

  win.timestamps.push(now);
  const remaining = Math.max(0, max - win.timestamps.length);
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(remaining));

  next();
}

// ── Pre-configured limiters for critical endpoints ──
// ALL use Redis for distributed state across Railway replicas.
// In-memory fallback only when Redis is completely unavailable.

/** Login: 10 attempts / minute per IP (brute-force protection) */
export const authRateLimiter = rateLimiter({
  max: 10,
  windowMs: 60_000,
  blockDurationMs: 2 * 60_000,
  keyFn: (req) => `auth:${getClientIp(req)}`,
});

/** Forgot password: 3 per hour per email (enumeration protection) */
export const forgotPasswordRateLimiter = rateLimiter({
  max: 3,
  windowMs: 60 * 60_000,
  blockDurationMs: 60 * 60_000,
  keyFn: (req) => {
    const email = (req.body?.email || "").toLowerCase().trim();
    return `forgot:${email || getClientIp(req)}`;
  },
});

/** Magic link requests: 5 / 10 min per IP */
export const magicLinkRateLimiter = rateLimiter({
  max: 5,
  windowMs: 10 * 60_000,
  blockDurationMs: 10 * 60_000,
});

/** General API: 300 / minute per user (authenticated) */
export const apiRateLimiter = rateLimiter({
  max: 300,
  windowMs: 60_000,
  blockDurationMs: 30_000,
  keyFn: (req) => {
    const user = (req as AuthRequest).user;
    return user?.userId ? `api:user:${user.userId}` : `api:ip:${getClientIp(req)}`;
  },
  skip: (req) => {
    return req.path === "/api/health" || req.path === "/api/health/live" || req.path === "/api/health/ready" || req.path === "/api/pwa/health";
  },
});

/** Public routes: 60 / minute per IP */
export const publicRateLimiter = rateLimiter({
  max: 60,
  windowMs: 60_000,
  blockDurationMs: 30_000,
  keyFn: (req) => `pub:${getClientIp(req)}`,
});

/** PHI data access: 100 / minute per user (patients, trips with PHI) */
export const phiRateLimiter = rateLimiter({
  max: 100,
  windowMs: 60_000,
  keyFn: (req) => {
    const user = (req as AuthRequest).user;
    return `phi:${user?.userId || getClientIp(req)}`;
  },
});

/** Password change: 5 attempts / hour per user */
export const passwordRateLimiter = rateLimiter({
  max: 5,
  windowMs: 60 * 60_000,
  blockDurationMs: 60 * 60_000,
  keyFn: (req) => {
    const user = (req as AuthRequest).user;
    return `passwd:${user?.userId || getClientIp(req)}`;
  },
});

// Export for testing
export { getClientIp, memWindows as _testWindows };
