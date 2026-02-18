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
    const connStr = process.env.DATABASE_URL || "";
    let host = "unknown";
    let port = 0;
    let ssl = false;
    let usingPooler = false;

    try {
      const url = new URL(connStr);
      host = url.hostname;
      port = parseInt(url.port || "5432", 10);
      ssl = url.searchParams.get("sslmode") !== "disable" && url.searchParams.get("ssl") !== "false";
      usingPooler = port === 6543;
    } catch {}

    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };

    let serverVersion = "unknown";
    try {
      const vRes = await db.execute(sql`SHOW server_version`);
      serverVersion = (vRes as any).rows?.[0]?.server_version || "unknown";
    } catch {}

    res.json({
      usingPooler,
      host,
      port,
      ssl,
      poolConfig: { max: 20, idleTimeoutMs: 30000, connectionTimeoutMs: 5000 },
      poolStats,
      serverVersion,
      note: usingPooler
        ? "Connected via PgBouncer pooler (port 6543)"
        : port === 5432
          ? "Connected directly (port 5432). Consider using pooler port 6543 for production."
          : `Connected on port ${port}`,
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

export function registerInfraOpsRoutes(app: Express) {
  app.use(router);
}
