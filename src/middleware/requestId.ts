import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

/**
 * Assigns a unique request ID to every request.
 * Uses X-Request-ID header if provided (from load balancer/proxy), otherwise generates one.
 * Exposes the ID in the response header for tracing.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers["x-request-id"] as string) || randomUUID().slice(0, 12);
  (req as any).requestId = id;
  res.setHeader("X-Request-ID", id);
  next();
}
