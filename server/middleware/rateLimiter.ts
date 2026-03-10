/**
 * In-memory sliding-window rate limiter.
 * Protects sensitive endpoints (auth, billing, PHI) from brute-force & abuse.
 * Uses IP + userId composite key for authenticated routes.
 */

import type { Request, Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";

interface SlidingWindow {
  timestamps: number[];
  blockedUntil: number;
}

const windows = new Map<string, SlidingWindow>();

// Cleanup every 5 minutes to prevent memory leak
const CLEANUP_INTERVAL = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, win] of windows) {
    if (win.timestamps.length === 0 && win.blockedUntil < now) {
      windows.delete(key);
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

export function rateLimiter(config: RateLimitConfig) {
  const {
    max,
    windowMs,
    blockDurationMs = windowMs,
    keyFn,
    skip,
  } = config;

  return (req: Request, res: Response, next: NextFunction) => {
    if (skip?.(req)) return next();

    const key = keyFn
      ? keyFn(req)
      : `${getClientIp(req)}:${req.path}`;

    const now = Date.now();
    let win = windows.get(key);

    if (!win) {
      win = { timestamps: [], blockedUntil: 0 };
      windows.set(key, win);
    }

    // Check if currently blocked
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

    // Prune old timestamps
    const cutoff = now - windowMs;
    win.timestamps = win.timestamps.filter(t => t > cutoff);

    if (win.timestamps.length >= max) {
      win.blockedUntil = now + blockDurationMs;
      console.warn(JSON.stringify({
        event: "rate_limit_exceeded",
        key,
        ip: getClientIp(req),
        path: req.path,
        method: req.method,
        userId: (req as AuthRequest).user?.userId,
        count: win.timestamps.length,
        max,
        ts: new Date().toISOString(),
      }));

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
  };
}

// ── Pre-configured limiters for critical endpoints ──

/** Auth endpoints: 10 attempts / 15 min, then block 15 min */
export const authRateLimiter = rateLimiter({
  max: 10,
  windowMs: 15 * 60_000,
  blockDurationMs: 15 * 60_000,
});

/** Magic link requests: 5 / 10 min per IP */
export const magicLinkRateLimiter = rateLimiter({
  max: 5,
  windowMs: 10 * 60_000,
  blockDurationMs: 10 * 60_000,
});

/** General API: 200 requests / minute per IP */
export const apiRateLimiter = rateLimiter({
  max: 200,
  windowMs: 60_000,
  blockDurationMs: 30_000,
  skip: (req) => {
    // Skip health checks and static assets
    return req.path === "/api/health" || req.path === "/api/pwa/health";
  },
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

/** Password change: 3 attempts / hour */
export const passwordRateLimiter = rateLimiter({
  max: 3,
  windowMs: 60 * 60_000,
  blockDurationMs: 60 * 60_000,
});

// Export for testing
export { getClientIp, windows as _testWindows };
