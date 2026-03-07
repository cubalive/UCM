import { Router, Request, Response } from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { billingRateLimiter } from "../middleware/rateLimiter.js";
import { runReconciliation } from "../services/reconciliationService.js";
import { getWebhookDashboardData } from "../services/webhookService.js";
import { generateBillingReport } from "../services/observabilityService.js";
import { getDeadLetterStats } from "../jobs/deadLetterProcessor.js";
import { getDb } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";
import logger from "../lib/logger.js";

const router = Router();
router.use(authenticate, authorize("admin"));

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

// Webhook dashboard
router.get("/webhooks/dashboard", async (_req: Request, res: Response) => {
  try {
    const data = await getWebhookDashboardData();
    res.json(data);
  } catch (err: any) {
    logger.error("Failed to get webhook dashboard", { error: err.message });
    res.status(500).json({ error: "Failed to get webhook dashboard" });
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
      .where(req.tenantId ? eq(auditLog.tenantId, req.tenantId) : undefined)
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

export default router;
