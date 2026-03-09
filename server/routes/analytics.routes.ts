import express, { type Response } from "express";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
import { storage } from "../storage";
import { db } from "../db";
import { trips, drivers, vehicles, patients, clinics, invoices } from "@shared/schema";
import { sql, eq, and, gte, lte, count, sum, desc } from "drizzle-orm";

const router = express.Router();

// ─── GET /api/stats — Dashboard KPI cards ────────────────────────────────
router.get("/api/stats", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
    const stats = await storage.getStats(cityId);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/stats/trip-status — Trip status breakdown ──────────────────
router.get("/api/stats/trip-status", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
    const summary = await storage.getTripStatusSummary(cityId);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/dashboard/driver-stats — Live driver presence ──────────────
router.get("/api/dashboard/driver-stats", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;

    const condition = cityId ? eq(drivers.cityId, cityId) : undefined;
    const allDrivers = await db.select().from(drivers).where(condition);

    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);

    const activeDrivers: any[] = [];
    const inRouteDrivers: any[] = [];
    const offlineHoldDrivers: any[] = [];

    for (const d of allDrivers) {
      if (d.status === "INACTIVE") continue;

      const entry = {
        id: d.id,
        name: `${d.firstName} ${d.lastName}`,
        lastSeenAt: d.lastSeenAt || d.updatedAt,
        status: d.dispatchStatus,
      };

      if (d.dispatchStatus === "enroute") {
        // Find active trip for this driver
        const activeTrips = await db.select({
          id: trips.id,
          publicId: trips.publicId,
          status: trips.status,
        })
          .from(trips)
          .where(and(eq(trips.driverId, d.id), eq(trips.status, "IN_PROGRESS")))
          .limit(1);

        inRouteDrivers.push({
          ...entry,
          tripPublicId: activeTrips[0]?.publicId || "N/A",
          tripStatus: activeTrips[0]?.status || d.dispatchStatus,
        });
      } else if (d.dispatchStatus === "available") {
        activeDrivers.push(entry);
      } else {
        offlineHoldDrivers.push({
          ...entry,
          reason: d.dispatchStatus === "hold" ? "hold" : "offline",
        });
      }
    }

    res.json({
      activeCount: activeDrivers.length,
      inRouteCount: inRouteDrivers.length,
      offlineHoldCount: offlineHoldDrivers.length,
      activeDrivers,
      inRouteDrivers,
      offlineHoldDrivers,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/analytics/trends — Weekly trend data for charts ────────────
router.get("/api/analytics/trends", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split("T")[0];

    const cityFilter = cityId ? sql`AND ${trips.cityId} = ${cityId}` : sql``;

    const dailyTrips = await db.execute(sql`
      SELECT
        DATE(${trips.scheduledDate}) as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ${trips.status} = 'COMPLETED') as completed,
        COUNT(*) FILTER (WHERE ${trips.status} = 'CANCELLED') as cancelled,
        COUNT(*) FILTER (WHERE ${trips.status} = 'NO_SHOW') as no_show,
        COUNT(*) FILTER (WHERE ${trips.status} = 'SCHEDULED') as scheduled,
        COUNT(*) FILTER (WHERE ${trips.status} = 'IN_PROGRESS') as in_progress,
        COALESCE(SUM(${trips.distanceMiles}), 0) as total_miles,
        COALESCE(AVG(${trips.distanceMiles}), 0) as avg_miles
      FROM ${trips}
      WHERE DATE(${trips.scheduledDate}) >= ${startDateStr}::date
      ${cityFilter}
      GROUP BY DATE(${trips.scheduledDate})
      ORDER BY date ASC
    `);

    const rows = (dailyTrips as any).rows || [];
    const trendData = rows.map((r: any) => ({
      date: r.date,
      label: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      total: Number(r.total),
      completed: Number(r.completed),
      cancelled: Number(r.cancelled),
      noShow: Number(r.no_show),
      scheduled: Number(r.scheduled),
      inProgress: Number(r.in_progress),
      totalMiles: Number(Number(r.total_miles).toFixed(1)),
      avgMiles: Number(Number(r.avg_miles).toFixed(1)),
    }));

    res.json({ trends: trendData, days, cityId: cityId || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/analytics/revenue-trends — Revenue by day ──────────────────
router.get("/api/analytics/revenue-trends", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
    const days = Math.min(parseInt(req.query.days as string) || 14, 90);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split("T")[0];

    const cityFilter = cityId ? sql`AND ${trips.cityId} = ${cityId}` : sql``;

    const dailyRevenue = await db.execute(sql`
      SELECT
        DATE(${trips.scheduledDate}) as date,
        COUNT(*) FILTER (WHERE ${trips.status} = 'COMPLETED') as completed_trips,
        COALESCE(SUM(CASE WHEN ${trips.status} = 'COMPLETED' THEN ${trips.distanceMiles} ELSE 0 END), 0) as revenue_miles,
        COUNT(DISTINCT ${trips.driverId}) as active_drivers
      FROM ${trips}
      WHERE DATE(${trips.scheduledDate}) >= ${startDateStr}::date
      ${cityFilter}
      GROUP BY DATE(${trips.scheduledDate})
      ORDER BY date ASC
    `);

    const rows = (dailyRevenue as any).rows || [];
    const data = rows.map((r: any) => ({
      date: r.date,
      label: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      completedTrips: Number(r.completed_trips),
      revenueMiles: Number(Number(r.revenue_miles).toFixed(1)),
      activeDrivers: Number(r.active_drivers),
    }));

    res.json({ data, days, cityId: cityId || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/analytics/system-diagnostics — For system health panel ─────
router.get(
  "/api/analytics/system-diagnostics",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const mem = process.memoryUsage();
      const uptime = process.uptime();

      // Check DB
      let dbOk = false;
      let dbLatencyMs = 0;
      try {
        const t0 = Date.now();
        await db.execute(sql`SELECT 1`);
        dbLatencyMs = Date.now() - t0;
        dbOk = true;
      } catch {}

      // Check Redis
      let redisOk = false;
      let redisLatencyMs = 0;
      try {
        const { getRedisClient } = await import("../lib/eventBus");
        const redis = getRedisClient();
        if (redis) {
          const t0 = Date.now();
          await redis.ping();
          redisLatencyMs = Date.now() - t0;
          redisOk = true;
        }
      } catch {}

      // Entity integrity checks
      const integrityChecks: {
        name: string;
        status: "ok" | "warning" | "critical";
        detail: string;
        fixable: boolean;
        fixAction?: string;
      }[] = [];

      // Check orphan trips (no valid driver)
      try {
        const orphanTrips = await db.execute(sql`
          SELECT COUNT(*) as cnt
          FROM ${trips} t
          WHERE t.driver_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ${drivers} d WHERE d.id = t.driver_id)
        `);
        const cnt = Number((orphanTrips as any).rows?.[0]?.cnt || 0);
        integrityChecks.push({
          name: "Orphan trips (missing driver)",
          status: cnt === 0 ? "ok" : "warning",
          detail: cnt === 0 ? "No orphaned trips" : `${cnt} trips reference deleted drivers`,
          fixable: cnt > 0,
          fixAction: cnt > 0 ? "nullify-orphan-trip-drivers" : undefined,
        });
      } catch {}

      // Check trips without city
      try {
        const noCityTrips = await db.execute(sql`
          SELECT COUNT(*) as cnt
          FROM ${trips} t
          WHERE t.city_id IS NULL
        `);
        const cnt = Number((noCityTrips as any).rows?.[0]?.cnt || 0);
        integrityChecks.push({
          name: "Trips without city assignment",
          status: cnt === 0 ? "ok" : "warning",
          detail: cnt === 0 ? "All trips have a city" : `${cnt} trips have no city assigned`,
          fixable: false,
        });
      } catch {}

      // Check drivers without vehicles (active)
      try {
        const noVehicleDrivers = await db.execute(sql`
          SELECT COUNT(*) as cnt
          FROM ${drivers} d
          WHERE d.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM driver_vehicle_assignments dva
            WHERE dva.driver_id = d.id AND dva.status = 'active'
          )
        `);
        const cnt = Number((noVehicleDrivers as any).rows?.[0]?.cnt || 0);
        integrityChecks.push({
          name: "Active drivers without vehicle",
          status: cnt === 0 ? "ok" : cnt <= 3 ? "warning" : "critical",
          detail: cnt === 0 ? "All active drivers have vehicles" : `${cnt} active drivers have no vehicle assigned`,
          fixable: false,
        });
      } catch {}

      // Check DB connectivity
      integrityChecks.push({
        name: "Database connectivity",
        status: dbOk ? "ok" : "critical",
        detail: dbOk ? `Connected (${dbLatencyMs}ms latency)` : "Database connection failed",
        fixable: false,
      });

      // Check Redis
      integrityChecks.push({
        name: "Redis connectivity",
        status: redisOk ? "ok" : "warning",
        detail: redisOk ? `Connected (${redisLatencyMs}ms latency)` : "Redis unavailable (cache disabled)",
        fixable: false,
      });

      // Memory check
      const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      integrityChecks.push({
        name: "Memory usage",
        status: heapUsedMB < 400 ? "ok" : heapUsedMB < 700 ? "warning" : "critical",
        detail: `Heap: ${heapUsedMB}MB, RSS: ${rssMB}MB`,
        fixable: heapUsedMB >= 700,
        fixAction: heapUsedMB >= 700 ? "gc-collect" : undefined,
      });

      res.json({
        uptime,
        memory: { rss: rssMB, heapUsed: heapUsedMB },
        database: { ok: dbOk, latencyMs: dbLatencyMs },
        redis: { ok: redisOk, latencyMs: redisLatencyMs },
        integrityChecks,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── POST /api/analytics/auto-fix — Attempt to fix a known issue ────────
router.post(
  "/api/analytics/auto-fix",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { action } = req.body;

      if (!action) {
        return res.status(400).json({ error: "action is required" });
      }

      switch (action) {
        case "nullify-orphan-trip-drivers": {
          const result = await db.execute(sql`
            UPDATE ${trips}
            SET driver_id = NULL, status = 'SCHEDULED'
            WHERE driver_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM ${drivers} d WHERE d.id = ${trips}.driver_id)
          `);
          const affected = (result as any).rowCount || 0;
          res.json({
            success: true,
            action,
            message: `Fixed ${affected} orphaned trips — set driver_id to NULL and status to SCHEDULED`,
            affected,
          });
          break;
        }

        case "gc-collect": {
          if (global.gc) {
            global.gc();
            const mem = process.memoryUsage();
            res.json({
              success: true,
              action,
              message: `Garbage collection triggered. Heap now: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
              affected: 0,
            });
          } else {
            res.json({
              success: false,
              action,
              message: "GC not exposed. Start Node with --expose-gc flag to enable manual garbage collection.",
              affected: 0,
            });
          }
          break;
        }

        default:
          res.status(400).json({ error: `Unknown fix action: ${action}` });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export function registerAnalyticsRoutes(app: express.Express) {
  app.use(router);
}
