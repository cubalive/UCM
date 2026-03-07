import { Router, Request, Response } from "express";
import { checkDbHealth } from "../db/index.js";
import { checkRedisHealth } from "../lib/redis.js";
import { checkStripeHealth } from "../lib/stripe.js";
import { getConnectedStats, getOnlineDrivers } from "../services/realtimeService.js";
import { collectMetrics, metricsToPrometheus } from "../services/metricsService.js";
import logger from "../lib/logger.js";

const router = Router();

router.get("/health", async (_req: Request, res: Response) => {
  const startTime = Date.now();

  const [dbHealth, redisHealth] = await Promise.all([
    checkDbHealth(),
    checkRedisHealth(),
  ]);

  let stripeHealth: { connected: boolean; latencyMs?: number } = { connected: false };
  try {
    stripeHealth = await checkStripeHealth();
  } catch { /* non-critical */ }

  const wsStats = getConnectedStats();
  const overallHealthy = dbHealth.connected;
  const totalLatencyMs = Date.now() - startTime;

  const status = {
    status: overallHealthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: { status: dbHealth.connected ? "up" : "down", latencyMs: dbHealth.latencyMs },
      redis: { status: redisHealth.connected ? "up" : "down", latencyMs: redisHealth.latencyMs },
      stripe: { status: stripeHealth.connected ? "up" : "unknown", latencyMs: stripeHealth.latencyMs },
      websocket: {
        status: "up",
        totalConnections: wsStats.totalConnections,
        onlineDrivers: wsStats.onlineDrivers,
        byRole: wsStats.byRole,
      },
    },
    responseTimeMs: totalLatencyMs,
  };

  if (!overallHealthy) logger.warn("Health check degraded", status);
  res.status(overallHealthy ? 200 : 503).json(status);
});

// Liveness
router.get("/health/live", (_req: Request, res: Response) => {
  res.status(200).json({ status: "alive" });
});

// Readiness
router.get("/health/ready", async (_req: Request, res: Response) => {
  const dbHealth = await checkDbHealth();
  if (dbHealth.connected) {
    res.status(200).json({ status: "ready" });
  } else {
    res.status(503).json({ status: "not ready", reason: "database unavailable" });
  }
});

// Trip pipeline monitor
router.get("/health/pipeline", async (_req: Request, res: Response) => {
  try {
    const { getDb } = await import("../db/index.js");
    const { trips } = await import("../db/schema.js");
    const { sql } = await import("drizzle-orm");
    const db = getDb();

    const [stats] = await db
      .select({
        total: sql<number>`count(*)`,
        requested: sql<number>`count(case when status = 'requested' then 1 end)`,
        assigned: sql<number>`count(case when status = 'assigned' then 1 end)`,
        en_route: sql<number>`count(case when status = 'en_route' then 1 end)`,
        arrived: sql<number>`count(case when status = 'arrived' then 1 end)`,
        in_progress: sql<number>`count(case when status = 'in_progress' then 1 end)`,
        completed_today: sql<number>`count(case when status = 'completed' and completed_at > now() - interval '24 hours' then 1 end)`,
        cancelled_today: sql<number>`count(case when status = 'cancelled' and updated_at > now() - interval '24 hours' then 1 end)`,
        stuck: sql<number>`count(case when status in ('assigned', 'en_route', 'arrived') and updated_at < now() - interval '2 hours' then 1 end)`,
      })
      .from(trips);

    const wsStats = getConnectedStats();

    const stuckCount = Number(stats.stuck);
    const requestedCount = Number(stats.requested);

    // Generate operational alerts
    const alerts: Array<{ level: string; message: string }> = [];
    if (stuckCount > 0) {
      alerts.push({ level: "warning", message: `${stuckCount} trip(s) stuck in active state for >2 hours` });
    }
    if (requestedCount > 10) {
      alerts.push({ level: "warning", message: `${requestedCount} unassigned trips in queue` });
    }
    if (wsStats.onlineDrivers === 0) {
      alerts.push({ level: "info", message: "No drivers currently online" });
    }

    res.json({
      pipeline: {
        requested: requestedCount,
        assigned: Number(stats.assigned),
        en_route: Number(stats.en_route),
        arrived: Number(stats.arrived),
        in_progress: Number(stats.in_progress),
        completedToday: Number(stats.completed_today),
        cancelledToday: Number(stats.cancelled_today),
        stuck: stuckCount,
      },
      drivers: {
        online: wsStats.onlineDrivers,
        connected: wsStats.byRole?.driver || 0,
      },
      alerts,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to get pipeline stats" });
  }
});

// Full system metrics (JSON)
router.get("/health/metrics", async (_req: Request, res: Response) => {
  try {
    const metrics = await collectMetrics();
    res.json(metrics);
  } catch (err: any) {
    logger.error("Failed to collect metrics", { error: err.message });
    res.status(500).json({ error: "Failed to collect metrics" });
  }
});

// Prometheus-compatible metrics endpoint
router.get("/health/prometheus", async (_req: Request, res: Response) => {
  try {
    const metrics = await collectMetrics();
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(metricsToPrometheus(metrics));
  } catch (err: any) {
    logger.error("Failed to export prometheus metrics", { error: err.message });
    res.status(500).send("# Error collecting metrics\n");
  }
});

export default router;
