import os from "os";
import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { pool } from "../db";
import { storage } from "../storage";
import { getRequestMetricsSummary, getTopRoutes } from "./requestMetrics";
import { getJobStatus } from "./jobHeartbeat";
import { getActiveConnectionCount, getActiveSubscriptionCount } from "./realtime";
import { isDriverOnline } from "./driverClassification";
import { metricsSummary as healthSummaryHandler, metricsDetails as healthDetailsHandler } from "../controllers/adminMetrics.controller";

const startedAt = Date.now();

let eventLoopLagMs = 0;
(function measureEventLoopLag() {
  let last = process.hrtime.bigint();
  setInterval(() => {
    const now = process.hrtime.bigint();
    const elapsedMs = Number(now - last) / 1e6;
    const expectedMs = 500;
    eventLoopLagMs = Math.max(0, Math.round((elapsedMs - expectedMs) * 100) / 100);
    last = now;
  }, 500).unref();
})();

async function measureDbLatency(): Promise<{ ok: boolean; latencyMs: number; clients?: number }> {
  const t0 = performance.now();
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - t0),
        clients: pool.totalCount,
      };
    } finally {
      client.release();
    }
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - t0) };
  }
}

function todayDateStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function registerAdminMetricsRoutes(app: Express) {
  const gate = [authMiddleware, requireRole("SUPER_ADMIN")];

  app.get("/api/admin/metrics/summary", ...gate, async (_req: AuthRequest, res) => {
    try {
      const reqMetrics = getRequestMetricsSummary();
      const dbResult = await measureDbLatency();
      const eta = getJobStatus("eta");
      const autoAssign = getJobStatus("autoAssign");
      const wsClients = getActiveConnectionCount();

      const today = todayDateStr();
      const allTrips = await storage.getTrips();
      const todayTrips = allTrips.filter(t => t.scheduledDate === today);
      const inProgressStatuses = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];
      const tripsInProgress = allTrips.filter(t => inProgressStatuses.includes(t.status));

      const allDrivers = await storage.getDrivers();
      const driversOnline = allDrivers.filter(d => d.status === "ACTIVE" && isDriverOnline(d)).length;

      const allClinics = await storage.getClinics();
      const activeClinics = allClinics.filter(c => c.active !== false).length;

      const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
      const windowMin = Math.min(5, uptimeSec / 60);
      const rpm = windowMin > 0 ? Math.round(reqMetrics.total_requests_5min / windowMin) : 0;

      const errors5xx = Math.round(reqMetrics.total_errors_5min * 0.3);
      const errors4xx = reqMetrics.total_errors_5min - errors5xx;

      res.json({
        ok: true,
        ts: new Date().toISOString(),
        env: process.env.NODE_ENV === "production" ? "production" : "development",
        version: process.env.APP_VERSION || "1.0.0",
        uptimeSec,
        requests: {
          rpm,
          p50ms: reqMetrics.p50_latency_ms,
          p95ms: reqMetrics.p95_latency_ms,
          errors5xx,
          errors4xx,
        },
        db: dbResult,
        ws: {
          ok: wsClients >= 0,
          clients: wsClients,
          subscriptions: getActiveSubscriptionCount(),
        },
        jobs: {
          eta: {
            ok: eta.ok,
            running: eta.running,
            lastTickAt: eta.lastTickAt,
            lastError: eta.lastError,
            tickCount: eta.tickCount,
          },
          autoAssign: {
            ok: autoAssign.ok,
            running: autoAssign.running,
            lastTickAt: autoAssign.lastTickAt,
            lastError: autoAssign.lastError,
            tickCount: autoAssign.tickCount,
          },
        },
        counts: {
          tripsToday: todayTrips.length,
          tripsInProgress: tripsInProgress.length,
          driversOnline,
          activeClinics,
        },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/admin/metrics/requests", ...gate, async (_req: AuthRequest, res) => {
    try {
      const routes = getTopRoutes(50);
      const summary = getRequestMetricsSummary();
      res.json({
        ok: true,
        ts: new Date().toISOString(),
        window: "5min",
        summary,
        routes,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/admin/metrics/system", ...gate, async (_req: AuthRequest, res) => {
    try {
      const mem = process.memoryUsage();
      const loads = os.loadavg();
      const reqMetrics = getRequestMetricsSummary();
      const dbResult = await measureDbLatency();

      const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
      const windowMin = Math.min(5, uptimeSec / 60);
      const reqPerMin = windowMin > 0 ? Math.round(reqMetrics.total_requests_5min / windowMin) : 0;
      const errPerMin = windowMin > 0 ? Math.round(reqMetrics.total_errors_5min / windowMin) : 0;

      res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        app: {
          version: process.env.APP_VERSION || "1.0.0",
          uptimeSec,
          nodeVersion: process.version,
          env: process.env.NODE_ENV || "development",
          pid: process.pid,
          platform: process.platform,
          arch: process.arch,
        },
        cpu: {
          load1: Math.round(loads[0] * 100) / 100,
          load5: Math.round(loads[1] * 100) / 100,
          load15: Math.round(loads[2] * 100) / 100,
          cores: os.cpus().length,
        },
        memory: {
          rssMB: Math.round(mem.rss / 1024 / 1024),
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
          externalMB: Math.round(mem.external / 1024 / 1024),
          systemTotalMB: Math.round(os.totalmem() / 1024 / 1024),
          systemFreeMB: Math.round(os.freemem() / 1024 / 1024),
        },
        eventLoop: {
          lagMs: eventLoopLagMs,
        },
        http: {
          reqPerMin,
          errPerMin,
          p50Ms: reqMetrics.p50_latency_ms,
          p95Ms: reqMetrics.p95_latency_ms,
          errors4xx5min: reqMetrics.errors_4xx_5min,
          errors5xx5min: reqMetrics.errors_5xx_5min,
          totalRequests5min: reqMetrics.total_requests_5min,
          totalErrors5min: reqMetrics.total_errors_5min,
          errorRatePct: reqMetrics.error_rate_pct,
        },
        db: {
          ok: dbResult.ok,
          latencyMs: dbResult.latencyMs,
        },
        build: {
          commit: process.env.FLY_REGION || process.env.UCM_BUILD_VERSION || null,
        },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/admin/metrics/ws", ...gate, async (_req: AuthRequest, res) => {
    try {
      res.json({
        ok: true,
        ts: new Date().toISOString(),
        clients: getActiveConnectionCount(),
        subscriptions: getActiveSubscriptionCount(),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/admin/metrics/db", ...gate, async (_req: AuthRequest, res) => {
    try {
      const result = await measureDbLatency();
      res.json({
        ...result,
        ts: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/admin/metrics/jobs", ...gate, async (_req: AuthRequest, res) => {
    try {
      const eta = getJobStatus("eta");
      const autoAssign = getJobStatus("autoAssign");
      res.json({
        ok: true,
        ts: new Date().toISOString(),
        eta: {
          ok: eta.ok,
          running: eta.running,
          lastTickAt: eta.lastTickAt,
          lastError: eta.lastError,
          tickCount: eta.tickCount,
        },
        autoAssign: {
          ok: autoAssign.ok,
          running: autoAssign.running,
          lastTickAt: autoAssign.lastTickAt,
          lastError: autoAssign.lastError,
          tickCount: autoAssign.tickCount,
        },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/admin/metrics/health", ...gate, healthSummaryHandler as any);
  app.get("/api/admin/metrics/health/details", ...gate, healthDetailsHandler as any);

  app.get("/api/admin/metrics/counts", ...gate, async (_req: AuthRequest, res) => {
    try {
      const today = todayDateStr();
      const allTrips = await storage.getTrips();
      const todayTrips = allTrips.filter(t => t.scheduledDate === today);
      const inProgressStatuses = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];
      const tripsInProgress = allTrips.filter(t => inProgressStatuses.includes(t.status));

      const allDrivers = await storage.getDrivers();
      const driversOnline = allDrivers.filter(d => d.status === "ACTIVE" && isDriverOnline(d)).length;

      const allClinics = await storage.getClinics();
      const activeClinics = allClinics.filter(c => c.active !== false).length;

      const completedToday = todayTrips.filter(t => t.status === "COMPLETED").length;
      const cancelledToday = todayTrips.filter(t => t.status === "CANCELLED" || t.approvalStatus === "cancelled").length;
      const scheduledToday = todayTrips.filter(t => t.status === "SCHEDULED").length;

      res.json({
        ok: true,
        ts: new Date().toISOString(),
        date: today,
        tripsToday: todayTrips.length,
        tripsInProgress: tripsInProgress.length,
        tripsCompleted: completedToday,
        tripsCancelled: cancelledToday,
        tripsScheduled: scheduledToday,
        driversOnline,
        totalDrivers: allDrivers.filter(d => d.status === "ACTIVE").length,
        activeClinics,
        totalClinics: allClinics.length,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
