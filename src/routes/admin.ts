import { Router, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { authenticate, authorize, tenantIsolation } from "../middleware/auth.js";
import { validateBody, validateParams, validateQuery, uuidParam, paginationQuery } from "../middleware/validation.js";
import { billingRateLimiter } from "../middleware/rateLimiter.js";
import { runReconciliation } from "../services/reconciliationService.js";
import { generateBillingReport } from "../services/observabilityService.js";
import { getDeadLetterStats } from "../jobs/deadLetterProcessor.js";
import { detectStuckTrips, detectOfflineDriversWithActiveTrips } from "../jobs/stuckTripDetector.js";
import { getDb } from "../db/index.js";
import { auditLog, trips, users, tenants, patients, invoices, driverStatus } from "../db/schema.js";
import { eq, desc, sql, and, count } from "drizzle-orm";
import { getConnectedStats, getOnlineDrivers } from "../services/realtimeService.js";
import { recordAudit } from "../services/auditService.js";
import { getTierLimits } from "../services/subscriptionService.js";
import logger from "../lib/logger.js";

const router = Router();
router.use(authenticate, authorize("admin"), tenantIsolation);

// ═══════════════════════════════════════
// User Management
// ═══════════════════════════════════════

const createUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.enum(["admin", "dispatcher", "driver", "clinic", "billing"]),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  role: z.enum(["admin", "dispatcher", "driver", "clinic", "billing"]).optional(),
  active: z.boolean().optional(),
});

// List users for this tenant
router.get("/users", validateQuery(paginationQuery), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const offset = (page - 1) * limit;

    const results = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        active: users.active,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.tenantId, req.tenantId!))
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.tenantId, req.tenantId!));

    res.json({ data: results, pagination: { page, limit, total: Number(total) } });
  } catch (err: any) {
    logger.error("Failed to list users", { error: err.message });
    res.status(500).json({ error: "Failed to list users" });
  }
});

// Create user
router.post("/users", validateBody(createUserSchema), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { email, password, firstName, lastName, role } = req.body;

    // Check tier limits
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.tenantId!));
    if (tenant) {
      const limits = getTierLimits(tenant.subscriptionTier || "starter");
      if (limits.maxUsers !== -1) {
        const [{ userCount }] = await db
          .select({ userCount: sql<number>`count(*)` })
          .from(users)
          .where(and(eq(users.tenantId, req.tenantId!), eq(users.active, true)));
        if (Number(userCount) >= limits.maxUsers) {
          res.status(403).json({ error: `User limit reached for ${tenant.subscriptionTier} plan (${limits.maxUsers} users)` });
          return;
        }
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(users)
      .values({ tenantId: req.tenantId!, email, passwordHash, firstName, lastName, role })
      .returning({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        active: users.active,
        createdAt: users.createdAt,
      });

    await recordAudit({
      tenantId: req.tenantId!,
      userId: req.user!.id,
      action: "user.created",
      resource: "user",
      resourceId: user.id,
      details: { email, role },
    });

    res.status(201).json(user);
  } catch (err: any) {
    if (err.message?.includes("duplicate") || err.code === "23505") {
      res.status(409).json({ error: "A user with this email already exists" });
      return;
    }
    logger.error("Failed to create user", { error: err.message });
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Update user
router.put("/users/:id", validateParams(uuidParam), validateBody(updateUserSchema), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, req.params.id as string), eq(users.tenantId, req.tenantId!)));

    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Prevent admin from deactivating themselves
    if (req.body.active === false && req.params.id as string === req.user!.id) {
      res.status(400).json({ error: "Cannot deactivate your own account" });
      return;
    }

    const [updated] = await db
      .update(users)
      .set({ ...req.body, updatedAt: new Date() })
      .where(and(eq(users.id, req.params.id as string), eq(users.tenantId, req.tenantId!)))
      .returning({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        active: users.active,
        updatedAt: users.updatedAt,
      });

    await recordAudit({
      tenantId: req.tenantId!,
      userId: req.user!.id,
      action: "user.updated",
      resource: "user",
      resourceId: req.params.id as string,
      details: req.body,
    });

    res.json(updated);
  } catch (err: any) {
    logger.error("Failed to update user", { error: err.message });
    res.status(500).json({ error: "Failed to update user" });
  }
});

// ═══════════════════════════════════════
// Tenant Settings
// ═══════════════════════════════════════

const updateTenantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  timezone: z.string().max(100).optional(),
  settings: z.record(z.unknown()).optional(),
});

router.get("/tenant", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.tenantId!));
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    // Gather operational summary
    const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.tenantId, req.tenantId!));
    const [patientCount] = await db.select({ count: sql<number>`count(*)` }).from(patients).where(eq(patients.tenantId, req.tenantId!));
    const [driverCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.tenantId, req.tenantId!), eq(users.role, "driver")));

    const limits = getTierLimits(tenant.subscriptionTier || "starter");

    res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        timezone: tenant.timezone,
        subscriptionTier: tenant.subscriptionTier,
        subscriptionStatus: tenant.subscriptionStatus,
        subscriptionExpiresAt: tenant.subscriptionExpiresAt,
        stripeOnboardingComplete: tenant.stripeOnboardingComplete,
        settings: tenant.settings,
        createdAt: tenant.createdAt,
      },
      usage: {
        users: Number(userCount.count),
        patients: Number(patientCount.count),
        drivers: Number(driverCount.count),
      },
      limits,
    });
  } catch (err: any) {
    logger.error("Failed to get tenant", { error: err.message });
    res.status(500).json({ error: "Failed to get tenant info" });
  }
});

router.put("/tenant", validateBody(updateTenantSchema), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [updated] = await db
      .update(tenants)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(tenants.id, req.tenantId!))
      .returning();

    await recordAudit({
      tenantId: req.tenantId!,
      userId: req.user!.id,
      action: "tenant.updated",
      resource: "tenant",
      resourceId: req.tenantId!,
      details: req.body,
    });

    res.json(updated);
  } catch (err: any) {
    logger.error("Failed to update tenant", { error: err.message });
    res.status(500).json({ error: "Failed to update tenant" });
  }
});

// ═══════════════════════════════════════
// Subscription Info
// ═══════════════════════════════════════

router.get("/subscription", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.tenantId!));
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const limits = getTierLimits(tenant.subscriptionTier || "starter");
    const [driverCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.tenantId, req.tenantId!), eq(users.role, "driver"), eq(users.active, true)));
    const [userCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.tenantId, req.tenantId!), eq(users.active, true)));

    res.json({
      tier: tenant.subscriptionTier,
      status: tenant.subscriptionStatus,
      expiresAt: tenant.subscriptionExpiresAt,
      limits,
      usage: {
        drivers: Number(driverCount.count),
        users: Number(userCount.count),
      },
      availableTiers: [
        { tier: "starter", maxTrips: 100, maxDrivers: 5, maxUsers: 10 },
        { tier: "professional", maxTrips: 1000, maxDrivers: 50, maxUsers: 100 },
        { tier: "enterprise", maxTrips: -1, maxDrivers: -1, maxUsers: -1 },
      ],
    });
  } catch (err: any) {
    logger.error("Failed to get subscription", { error: err.message });
    res.status(500).json({ error: "Failed to get subscription info" });
  }
});

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
