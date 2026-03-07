import { Router, Request, Response } from "express";
import { authenticate, authorize, tenantIsolation } from "../middleware/auth.js";
import { billingRateLimiter } from "../middleware/rateLimiter.js";
import { runReconciliation } from "../services/reconciliationService.js";
import { generateBillingReport } from "../services/observabilityService.js";
import { getDeadLetterStats } from "../jobs/deadLetterProcessor.js";
import { detectStuckTrips, detectOfflineDriversWithActiveTrips } from "../jobs/stuckTripDetector.js";
import { getDb } from "../db/index.js";
import { auditLog, trips } from "../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";
import { getConnectedStats, getOnlineDrivers } from "../services/realtimeService.js";
import logger from "../lib/logger.js";

const router = Router();
router.use(authenticate, authorize("admin"), tenantIsolation);

// Reconciliation report
router.get("/reconciliation", billingRateLimiter, async (_req: Request, res: Response) => {
  try {
    const result = await runReconciliation();
    res.json(result);
  } catch (err: any) {
    logger.error("Reconciliation failed", { error: err.message });
    res.status(500).json({ error: "Reconciliation failed" });
  }
});

// Audit log
router.get("/audit-log", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const results = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.tenantId, req.tenantId!))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: results });
  } catch (err: any) {
    logger.error("Failed to get audit log", { error: err.message });
    res.status(500).json({ error: "Failed to get audit log" });
  }
});

// Billing reconciliation report
router.get("/billing-report", billingRateLimiter, async (req: Request, res: Response) => {
  try {
    const report = await generateBillingReport(req.tenantId);
    res.json(report);
  } catch (err: any) {
    logger.error("Failed to generate billing report", { error: err.message });
    res.status(500).json({ error: "Failed to generate billing report" });
  }
});

// Dead letter queue stats
router.get("/dead-letter-stats", async (_req: Request, res: Response) => {
  try {
    const stats = await getDeadLetterStats();
    res.json(stats);
  } catch (err: any) {
    logger.error("Failed to get dead letter stats", { error: err.message });
    res.status(500).json({ error: "Failed to get dead letter stats" });
  }
});

// Driver online monitor
router.get("/drivers/online", async (req: Request, res: Response) => {
  try {
    const onlineDrivers = getOnlineDrivers(req.tenantId!);
    const wsStats = getConnectedStats();
    res.json({ online: onlineDrivers, stats: wsStats });
  } catch (err: any) {
    logger.error("Failed to get online drivers", { error: err.message });
    res.status(500).json({ error: "Failed to get online drivers" });
  }
});

// Trip pipeline monitor
router.get("/trip-pipeline", async (req: Request, res: Response) => {
  try {
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
      .from(trips)
      .where(eq(trips.tenantId, req.tenantId!));

    res.json({
      requested: Number(stats.requested),
      assigned: Number(stats.assigned),
      en_route: Number(stats.en_route),
      arrived: Number(stats.arrived),
      in_progress: Number(stats.in_progress),
      completedToday: Number(stats.completed_today),
      cancelledToday: Number(stats.cancelled_today),
      stuck: Number(stats.stuck),
    });
  } catch (err: any) {
    logger.error("Failed to get trip pipeline", { error: err.message });
    res.status(500).json({ error: "Failed to get trip pipeline" });
  }
});

// Operational alerts — stuck trips and offline drivers with active trips
router.get("/operational-alerts", async (req: Request, res: Response) => {
  try {
    const [stuckTrips, offlineDriversWithTrips] = await Promise.all([
      detectStuckTrips(),
      detectOfflineDriversWithActiveTrips(),
    ]);

    // Filter to tenant's alerts
    const tenantStuckTrips = stuckTrips.filter(t => t.tenantId === req.tenantId);
    const tenantOfflineDrivers = offlineDriversWithTrips.filter(d => d.tenantId === req.tenantId);

    const alerts: Array<{ level: string; type: string; message: string; details: any }> = [];

    if (tenantStuckTrips.length > 0) {
      alerts.push({
        level: "warning",
        type: "stuck_trips",
        message: `${tenantStuckTrips.length} trip(s) stuck in active state for >2 hours`,
        details: tenantStuckTrips,
      });
    }

    if (tenantOfflineDrivers.length > 0) {
      alerts.push({
        level: "warning",
        type: "offline_drivers_with_trips",
        message: `${tenantOfflineDrivers.length} offline driver(s) with active trips`,
        details: tenantOfflineDrivers,
      });
    }

    res.json({ alerts, timestamp: new Date().toISOString() });
  } catch (err: any) {
    logger.error("Failed to get operational alerts", { error: err.message });
    res.status(500).json({ error: "Failed to get operational alerts" });
  }
});

export default router;
