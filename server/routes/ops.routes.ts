import crypto from "crypto";
import express, { type Express } from "express";
import type { Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { pool, db } from "../db";
import { sql } from "drizzle-orm";
import { isJobEngineRunning } from "../lib/jobEngine";
import { getQueueStats } from "../lib/jobQueue";
import { getActiveConnectionCount, getActiveSubscriptionCount } from "../lib/realtime";
import { purgeExpiredRouteCache } from "../lib/googleMaps";

const router = express.Router();

router.get("/api/ops/db-info", authMiddleware, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response) => {
  try {
    const connStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
    let host = "unknown";
    let port = 0;
    let dbName = "unknown";
    let ssl = false;
    let usingPooler = false;

    try {
      const url = new URL(connStr);
      host = url.hostname;
      port = parseInt(url.port || "5432", 10);
      dbName = url.pathname.replace(/^\//, "") || "unknown";
      ssl = url.searchParams.get("sslmode") !== "disable" && url.searchParams.get("ssl") !== "false";
      usingPooler = port === 6543;
    } catch {}

    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };

    let serverVersion = "unknown";
    let currentUser = "unknown";
    try {
      const vRes = await db.execute(sql`SHOW server_version`);
      serverVersion = (vRes as any).rows?.[0]?.server_version || "unknown";
      const uRes = await db.execute(sql`SELECT current_user AS cu`);
      currentUser = (uRes as any).rows?.[0]?.cu || "unknown";
    } catch {}

    const redactedHost = host.length > 12
      ? host.slice(0, 6) + "***" + host.slice(-6)
      : host;
    const dbFingerprint = crypto
      .createHash("sha256")
      .update(`${host}:${port}:${dbName}:${serverVersion}`)
      .digest("hex")
      .slice(0, 16);

    res.json({
      dbHost: redactedHost,
      dbPort: port,
      dbName,
      currentUser,
      poolerDetected: usingPooler,
      ssl,
      serverVersion,
      dbFingerprint,
      poolConfig: { max: 20, idleTimeoutMs: 30000, connectionTimeoutMs: 5000 },
      poolStats,
      note: usingPooler
        ? "Connected via PgBouncer pooler (port 6543)"
        : port === 5432
          ? "Connected directly (port 5432). Consider using pooler port 6543 for production."
          : `Connected on port ${port}`,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/ops/readyz", authMiddleware, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response) => {
  const checks: Record<string, { ok: boolean; latencyMs?: number; note?: string }> = {};

  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = { ok: true, latencyMs: Date.now() - dbStart };
  } catch (err: any) {
    checks.database = { ok: false, latencyMs: Date.now() - dbStart, note: err.message };
  }

  checks.jobEngine = { ok: isJobEngineRunning(), note: isJobEngineRunning() ? "running" : "stopped" };

  try {
    const stats = await getQueueStats();
    checks.jobQueue = { ok: true, note: `queued=${stats.queued} working=${stats.working}` };
  } catch (err: any) {
    checks.jobQueue = { ok: false, note: err.message };
  }

  checks.websocket = {
    ok: true,
    note: `connections=${getActiveConnectionCount()} subscriptions=${getActiveSubscriptionCount()}`,
  };

  const allOk = Object.values(checks).every(c => c.ok);

  res.status(allOk ? 200 : 503).json({
    ready: allOk,
    checks,
    uptime: process.uptime(),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
    timestamp: new Date().toISOString(),
  });
});

router.post("/api/ops/route-cache/purge", authMiddleware, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response) => {
  try {
    const deleted = await purgeExpiredRouteCache();
    res.json({ purged: deleted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

let seedStatus: {
  lastRunAt: string | null;
  status: "idle" | "running" | "completed" | "failed";
  preset: string | null;
  counts: Record<string, number> | null;
  error: string | null;
  durationMs: number | null;
} = { lastRunAt: null, status: "idle", preset: null, counts: null, error: null, durationMs: null };

router.post("/api/ops/seed/run", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const preset = req.body?.preset || "FIELD_TEST_V1";
  if (seedStatus.status === "running") {
    return res.status(409).json({ message: "Seed is already running", status: seedStatus });
  }

  seedStatus = { lastRunAt: new Date().toISOString(), status: "running", preset, counts: null, error: null, durationMs: null };
  res.json({ message: "Seed started", preset, status: seedStatus });

  const startMs = Date.now();
  const { spawn } = await import("child_process");
  const child = spawn("npx", ["tsx", "server/scripts/seed-ucm.ts"], {
    cwd: process.cwd(),
    stdio: "pipe",
    env: { ...process.env },
  });

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  child.on("close", async (code) => {
    if (code === 0) {
      try {
        const countRes = await db.execute(sql`
          SELECT 'companies' as entity, count(*)::int as c FROM companies
          UNION ALL SELECT 'cities', count(*)::int FROM cities
          UNION ALL SELECT 'users', count(*)::int FROM users
          UNION ALL SELECT 'vehicles', count(*)::int FROM vehicles
          UNION ALL SELECT 'drivers', count(*)::int FROM drivers
          UNION ALL SELECT 'clinics', count(*)::int FROM clinics
          UNION ALL SELECT 'patients', count(*)::int FROM patients
          UNION ALL SELECT 'trips', count(*)::int FROM trips
          UNION ALL SELECT 'invoices', count(*)::int FROM invoices
          ORDER BY entity
        `);
        const counts: Record<string, number> = {};
        for (const row of (countRes as any).rows) {
          counts[row.entity] = row.c;
        }
        seedStatus = { lastRunAt: seedStatus.lastRunAt, status: "completed", preset, counts, error: null, durationMs: Date.now() - startMs };
      } catch (err: any) {
        seedStatus = { lastRunAt: seedStatus.lastRunAt, status: "completed", preset, counts: null, error: "Seed completed but count query failed: " + err.message?.slice(0, 200), durationMs: Date.now() - startMs };
      }
    } else {
      seedStatus = { lastRunAt: seedStatus.lastRunAt, status: "failed", preset, counts: null, error: stderr.slice(0, 500) || `Exit code ${code}`, durationMs: Date.now() - startMs };
    }
  });

  child.on("error", (err: any) => {
    seedStatus = { lastRunAt: seedStatus.lastRunAt, status: "failed", preset, counts: null, error: err.message?.slice(0, 500), durationMs: Date.now() - startMs };
  });
});

router.get("/api/ops/seed/status", authMiddleware, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response) => {
  try {
    const countRes = await db.execute(sql`
      SELECT 'companies' as entity, count(*)::int as c FROM companies
      UNION ALL SELECT 'cities', count(*)::int FROM cities
      UNION ALL SELECT 'users', count(*)::int FROM users
      UNION ALL SELECT 'vehicles', count(*)::int FROM vehicles
      UNION ALL SELECT 'drivers', count(*)::int FROM drivers
      UNION ALL SELECT 'clinics', count(*)::int FROM clinics
      UNION ALL SELECT 'patients', count(*)::int FROM patients
      UNION ALL SELECT 'trips', count(*)::int FROM trips
      UNION ALL SELECT 'invoices', count(*)::int FROM invoices
      ORDER BY entity
    `);
    const currentCounts: Record<string, number> = {};
    for (const row of (countRes as any).rows) {
      currentCounts[row.entity] = row.c;
    }
    res.json({ ...seedStatus, currentCounts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

import {
  getSystemMap, getSystemStatus, runSmokeTest, getSmokeRuns,
  getCompanyDataOverview, getImportRuns, getImportRunEvents,
} from "../controllers/systemStatus.controller";
import { alertAcknowledgments, auditLog, users } from "@shared/schema";
import { eq, and, gt, desc } from "drizzle-orm";

async function resolveUserName(userId: number): Promise<string> {
  try {
    const [u] = await db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(eq(users.id, userId));
    if (u?.firstName || u?.lastName) return `${u.firstName || ""} ${u.lastName || ""}`.trim();
    return u?.email || `User #${userId}`;
  } catch { return `User #${userId}`; }
}

router.get("/api/ops/system-map", authMiddleware, requireRole("SUPER_ADMIN"), getSystemMap);
router.get("/api/ops/system-status", authMiddleware, requireRole("SUPER_ADMIN"), getSystemStatus);
router.post("/api/ops/smoke-run", authMiddleware, requireRole("SUPER_ADMIN"), runSmokeTest);
router.get("/api/ops/smoke-runs", authMiddleware, requireRole("SUPER_ADMIN"), getSmokeRuns);
router.get("/api/ops/company/:id/overview", authMiddleware, requireRole("SUPER_ADMIN"), getCompanyDataOverview);
router.get("/api/ops/import-runs", authMiddleware, requireRole("SUPER_ADMIN"), getImportRuns);
router.get("/api/ops/import-runs/:id/events", authMiddleware, requireRole("SUPER_ADMIN"), getImportRunEvents);

router.get("/api/ops/alert-acks", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(alertAcknowledgments)
      .where(and(
        eq(alertAcknowledgments.dismissed, false),
        gt(alertAcknowledgments.expiresAt, new Date())
      ))
      .orderBy(desc(alertAcknowledgments.createdAt))
      .limit(200);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/ops/alert-acks/history", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res: Response) => {
  try {
    const alertCode = req.query.alertCode as string | undefined;
    const where = alertCode
      ? eq(alertAcknowledgments.alertCode, alertCode)
      : undefined;
    const rows = await db
      .select()
      .from(alertAcknowledgments)
      .where(where)
      .orderBy(desc(alertAcknowledgments.createdAt))
      .limit(50);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/ops/alert-acks", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res: Response) => {
  try {
    const { alertCode, note, originSubdomain, expiryHours } = req.body;
    if (!alertCode) return res.status(400).json({ error: "alertCode required" });

    const hours = typeof expiryHours === "number" && expiryHours > 0 ? expiryHours : 6;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    const userId = req.user!.userId;
    const userName = await resolveUserName(userId);
    const userRole = req.user!.role || "UNKNOWN";

    const [ack] = await db.insert(alertAcknowledgments).values({
      alertCode,
      note: note || null,
      acknowledgedById: userId,
      acknowledgedByName: userName,
      acknowledgedByRole: userRole,
      originSubdomain: originSubdomain || null,
      expiresAt,
      companyId: req.user!.companyId || null,
    }).returning();

    await db.insert(auditLog).values({
      userId,
      action: "ALERT_ACKNOWLEDGED",
      entity: "alert_acknowledgment",
      entityId: ack.id,
      details: `Alert "${alertCode}" acknowledged${note ? `: ${note}` : ""}. Expires at ${expiresAt.toISOString()}`,
      actorRole: userRole,
      companyId: req.user!.companyId || null,
      metadataJson: { alertCode, note, originSubdomain, expiryHours: hours },
    });

    res.json(ack);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/ops/alert-acks/:id/dismiss", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const userId = req.user!.userId;
    const userName = await resolveUserName(userId);
    const userRole = req.user!.role || "UNKNOWN";
    const { note } = req.body || {};

    const [updated] = await db
      .update(alertAcknowledgments)
      .set({
        dismissed: true,
        dismissedById: userId,
        dismissedByName: userName,
        dismissedAt: new Date(),
      })
      .where(eq(alertAcknowledgments.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Acknowledgment not found" });

    await db.insert(auditLog).values({
      userId,
      action: "ALERT_DISMISSED",
      entity: "alert_acknowledgment",
      entityId: id,
      details: `Alert "${updated.alertCode}" dismissed/hidden by ${userName}${note ? `: ${note}` : ""}`,
      actorRole: userRole,
      companyId: req.user!.companyId || null,
      metadataJson: { alertCode: updated.alertCode, dismissNote: note, originSubdomain: req.body?.originSubdomain },
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/ops/alert-acks/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const userId = req.user!.userId;
    const userRole = req.user!.role || "UNKNOWN";
    const userName = await resolveUserName(userId);

    const [existing] = await db.select().from(alertAcknowledgments).where(eq(alertAcknowledgments.id, id));
    if (!existing) return res.status(404).json({ error: "Not found" });

    await db.delete(alertAcknowledgments).where(eq(alertAcknowledgments.id, id));

    await db.insert(auditLog).values({
      userId,
      action: "ALERT_ACK_DELETED",
      entity: "alert_acknowledgment",
      entityId: id,
      details: `Alert acknowledgment "${existing.alertCode}" deleted by ${userName}`,
      actorRole: userRole,
      companyId: req.user!.companyId || null,
      metadataJson: { alertCode: existing.alertCode, deletedAck: existing },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function registerInfraOpsRoutes(app: Express) {
  app.use(router);
}
