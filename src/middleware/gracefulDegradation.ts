import { Request, Response, NextFunction } from "express";
import { isRedisAvailable } from "../lib/redis.js";
import logger from "../lib/logger.js";

export function requireStripe(req: Request, res: Response, next: NextFunction): void {
  // Stripe operations should fail gracefully with a clear error
  // rather than hanging or returning cryptic responses
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      logger.error("Stripe operation timed out", { path: req.path });
      res.status(504).json({
        error: "Payment service temporarily unavailable",
        retryable: true,
      });
    }
  }, 30000); // 30s timeout for Stripe operations

  res.on("finish", () => clearTimeout(timeout));
  next();
}

export function redisOptional(req: Request, res: Response, next: NextFunction): void {
  if (!isRedisAvailable()) {
    logger.warn("Redis unavailable, operating without cache", { path: req.path });
    // Continue without Redis — feature degrades but doesn't break
  }
  next();
}

export function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; delayMs?: number; retryableErrors?: string[] } = {}
): Promise<T> {
  const { maxRetries = 3, delayMs = 1000, retryableErrors = [] } = options;

  return (async () => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;

        const isRetryable =
          retryableErrors.length === 0 ||
          retryableErrors.some((msg) => err.message?.includes(msg));

        if (!isRetryable || attempt === maxRetries) {
          throw err;
        }

        const delay = delayMs * Math.pow(2, attempt);
        logger.warn(`Retrying operation (attempt ${attempt + 1}/${maxRetries})`, {
          error: err.message,
          nextRetryMs: delay,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  })();
}
