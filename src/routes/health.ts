import { Router, Request, Response } from "express";
import { checkDbHealth } from "../db/index.js";
import { checkRedisHealth } from "../lib/redis.js";
import { checkStripeHealth } from "../lib/stripe.js";
import logger from "../lib/logger.js";

const router = Router();

router.get("/health", async (_req: Request, res: Response) => {
  const startTime = Date.now();

  const [dbHealth, redisHealth] = await Promise.all([
    checkDbHealth(),
    checkRedisHealth(),
  ]);

  // Stripe health is optional — don't block on it in prod
  let stripeHealth: { connected: boolean; latencyMs?: number } = { connected: false };
  try {
    stripeHealth = await checkStripeHealth();
  } catch {
    // Stripe check is non-critical
  }

  const overallHealthy = dbHealth.connected;
  const totalLatencyMs = Date.now() - startTime;

  const status = {
    status: overallHealthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: {
        status: dbHealth.connected ? "up" : "down",
        latencyMs: dbHealth.latencyMs,
      },
      redis: {
        status: redisHealth.connected ? "up" : "down",
        latencyMs: redisHealth.latencyMs,
      },
      stripe: {
        status: stripeHealth.connected ? "up" : "unknown",
        latencyMs: stripeHealth.latencyMs,
      },
    },
    responseTimeMs: totalLatencyMs,
  };

  if (!overallHealthy) {
    logger.warn("Health check degraded", status);
  }

  res.status(overallHealthy ? 200 : 503).json(status);
});

// Simple liveness check — always returns 200 if process is up
router.get("/health/live", (_req: Request, res: Response) => {
  res.status(200).json({ status: "alive" });
});

// Readiness check — confirms DB is available
router.get("/health/ready", async (_req: Request, res: Response) => {
  const dbHealth = await checkDbHealth();
  if (dbHealth.connected) {
    res.status(200).json({ status: "ready" });
  } else {
    res.status(503).json({ status: "not ready", reason: "database unavailable" });
  }
});

export default router;
