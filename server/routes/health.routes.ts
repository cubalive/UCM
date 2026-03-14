import type { Express } from "express";
import type { Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { resolve } from "path";

let pkgVersion = "unknown";
try {
  const raw = readFileSync(resolve(process.cwd(), "package.json"), "utf-8");
  pkgVersion = JSON.parse(raw).version || "unknown";
} catch {}

const APP_VERSION = process.env.UCM_BUILD_VERSION || process.env.BUILD_VERSION || pkgVersion;
const startTime = Date.now();

export function registerHealthRoutes(app: Express) {
  // ── Full health check ───────────────────────────────────────────────────
  app.get("/api/health", async (_req: Request, res: Response) => {
    let dbOk = false;
    let dbLatencyMs = 0;

    try {
      const dbStart = Date.now();
      await db.execute(sql`SELECT 1`);
      dbLatencyMs = Date.now() - dbStart;
      dbOk = true;
    } catch {}

    let redisStatus: { status: string; latencyMs?: number; error?: string } = { status: "not_configured" };
    try {
      const { pingRedis, isRedisConnected } = await import("../lib/redis");
      if (isRedisConnected()) {
        const pingResult = await pingRedis();
        redisStatus = { status: pingResult.ok ? "connected" : "error", latencyMs: pingResult.latencyMs };
      }
    } catch (err: any) {
      redisStatus = { status: "error", error: err.message };
    }

    // External service checks (non-blocking, best-effort)
    const externalChecks = await checkExternalServices();

    // Circuit breaker states
    let circuitStates: Record<string, any> = {};
    try {
      const { getCircuitBreakerStats } = await import("../lib/circuitBreaker");
      circuitStates = getCircuitBreakerStats();
    } catch {}

    // Scheduler status
    let schedulerStatus: Record<string, any> = {};
    try {
      const { getSchedulerStates } = await import("../lib/schedulerHarness");
      schedulerStatus = getSchedulerStates();
    } catch {}

    // WebSocket connection count
    let wsConnections = 0;
    try {
      const { getWss } = await import("../lib/realtime");
      const wss = getWss();
      if (wss) {
        wsConnections = wss.clients.size;
      }
    } catch {}

    // Domain events stats
    let domainEventStats: Record<string, any> = {};
    try {
      const { getStats } = await import("../lib/domainEvents");
      domainEventStats = getStats();
    } catch {}

    const mem = process.memoryUsage();
    const runMode = process.env.RUN_MODE || process.env.ROLE_MODE || "all";
    const healthy = dbOk;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? "healthy" : "unhealthy",
      version: APP_VERSION,
      packageVersion: pkgVersion,
      runMode,
      uptime: Math.round(process.uptime()),
      startedAt: new Date(startTime).toISOString(),
      checks: {
        database: {
          status: dbOk ? "ok" : "error",
          latencyMs: dbLatencyMs,
        },
        redis: redisStatus,
        external: externalChecks,
        circuitBreakers: circuitStates,
        schedulers: schedulerStatus,
        websocket: {
          connections: wsConnections,
        },
        domainEvents: domainEventStats,
        memory: {
          rss_mb: Math.round(mem.rss / 1024 / 1024),
          heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
          external_mb: Math.round(mem.external / 1024 / 1024),
        },
      },
      node: process.version,
      pid: process.pid,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Readiness check ─────────────────────────────────────────────────────
  app.get("/api/health/ready", async (_req: Request, res: Response) => {
    let dbOk = false;
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {}

    let redisOk = false;
    try {
      const { isRedisConnected } = await import("../lib/redis");
      redisOk = isRedisConnected();
    } catch {}

    const ready = dbOk;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      db: dbOk,
      redis: redisOk,
      uptime: Math.round(process.uptime()),
    });
  });

  // ── Liveness check ─────────────────────────────────────────────────────
  app.get("/api/health/live", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "alive",
      uptime: Math.round(process.uptime()),
      pid: process.pid,
    });
  });

  // ── Deep health check for admin dashboard ─────────────────────────────
  app.get("/api/admin/health/deep", async (_req: Request, res: Response) => {
    // Services health
    const services: Record<string, any> = {};

    // Database
    try {
      const dbStart = Date.now();
      const poolResult = await db.execute(sql`SELECT count(*) as cnt FROM pg_stat_activity WHERE datname = current_database()`);
      const dbLatency = Date.now() - dbStart;
      const connCount = (poolResult as any).rows?.[0]?.cnt || 0;
      services.database = { status: "ok", latencyMs: dbLatency, connectionPool: { active: Number(connCount) } };
    } catch (err: any) {
      services.database = { status: "error", latencyMs: 0, error: err.message };
    }

    // Redis
    try {
      const { pingRedis, isRedisConnected } = await import("../lib/redis");
      if (isRedisConnected()) {
        const ping = await pingRedis();
        services.redis = { status: ping.ok ? "ok" : "error", latencyMs: ping.latencyMs };
      } else {
        services.redis = { status: "not_configured" };
      }
    } catch {
      services.redis = { status: "not_configured" };
    }

    // External services (Stripe, Twilio, Google Maps, Firebase)
    const externalResults = await checkExternalServices();
    services.stripe = externalResults.stripe || { status: "not_configured" };
    services.twilio = externalResults.twilio || { status: "not_configured" };
    services.googleMaps = externalResults.googleMaps || { status: "not_configured" };

    // Firebase check
    services.firebase = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      ? { status: "ok", latencyMs: 0 }
      : { status: "not_configured" };

    // Schedulers
    let schedulers: Record<string, any> = {};
    try {
      const { getSchedulerStates } = await import("../lib/schedulerHarness");
      const states = getSchedulerStates();
      for (const [name, state] of Object.entries(states)) {
        const s = state as any;
        const errorRate = s.totalRuns > 0 ? s.failureCount / s.totalRuns : 0;
        let status: "healthy" | "degraded" | "failed" = "healthy";
        if (errorRate > 0.5) status = "failed";
        else if (errorRate > 0.1 || s.failureCount > 3) status = "degraded";
        schedulers[name] = {
          lastRun: s.lastRunAt,
          lastSuccess: s.lastSuccessAt,
          status,
          lastRunDurationMs: s.avgDurationMs,
          errorRate: Math.round(errorRate * 100) / 100,
          totalRuns: s.totalRuns,
          successCount: s.successCount,
          failureCount: s.failureCount,
          isRunning: s.isRunning,
          active: s.active,
        };
      }
    } catch {}

    // Metrics
    let metrics: Record<string, any> = {};
    try {
      const { getCachedSnapshot } = await import("../lib/aiEngine");
      const snapshot = await getCachedSnapshot();
      if (snapshot) {
        metrics = {
          activeTrips: snapshot.metrics.activeTrips,
          onlineDrivers: snapshot.metrics.driversOnline,
          pendingClaims: 0,
          websocketConnections: 0,
          queueDepth: 0,
          errorRateLast5min: snapshot.metrics.errorRatePct,
        };
      }
    } catch {}

    // WebSocket connections
    try {
      const { getWss } = await import("../lib/realtime");
      const wss = getWss();
      if (wss) metrics.websocketConnections = wss.clients.size;
    } catch {}

    // Pending claims count
    try {
      const claimResult = await db.execute(sql`
        SELECT count(*) as cnt FROM medicaid_claims WHERE status IN ('draft', 'submitted')
      `);
      metrics.pendingClaims = Number((claimResult as any).rows?.[0]?.cnt || 0);
    } catch {}

    res.json({
      services,
      schedulers,
      metrics,
      memory: {
        rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Circuit breaker states endpoint ─────────────────────────────────────
  app.get("/api/health/circuits", async (_req: Request, res: Response) => {
    let circuitStates: Record<string, any> = {};
    try {
      const { getCircuitBreakerStats } = await import("../lib/circuitBreaker");
      circuitStates = getCircuitBreakerStats();
    } catch {}

    const allClosed = Object.values(circuitStates).every(
      (s: any) => s.state === "CLOSED",
    );

    res.status(allClosed ? 200 : 503).json({
      status: allClosed ? "all_closed" : "degraded",
      circuits: circuitStates,
      timestamp: new Date().toISOString(),
    });
  });
}

// ── External service checks ───────────────────────────────────────────────

interface ServiceCheckResult {
  status: "ok" | "error" | "not_configured";
  latencyMs?: number;
  error?: string;
}

async function checkExternalServices(): Promise<Record<string, ServiceCheckResult>> {
  const results: Record<string, ServiceCheckResult> = {};

  // Run all checks concurrently with individual timeouts
  const [stripeResult, twilioResult, googleMapsResult] = await Promise.all([
    checkStripe(),
    checkTwilio(),
    checkGoogleMaps(),
  ]);

  results.stripe = stripeResult;
  results.twilio = twilioResult;
  results.googleMaps = googleMapsResult;

  return results;
}

async function checkStripe(): Promise<ServiceCheckResult> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return { status: "not_configured" };

  try {
    const start = Date.now();
    // Minimal Stripe API call to validate the key
    const resp = await fetchWithTimeout("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${stripeKey}` },
    }, 5000);
    const latencyMs = Date.now() - start;
    return { status: resp.ok ? "ok" : "error", latencyMs };
  } catch (err: any) {
    return { status: "error", error: err.message?.slice(0, 200) };
  }
}

async function checkTwilio(): Promise<ServiceCheckResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return { status: "not_configured" };

  try {
    const start = Date.now();
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const resp = await fetchWithTimeout(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
      { headers: { Authorization: `Basic ${credentials}` } },
      5000,
    );
    const latencyMs = Date.now() - start;
    return { status: resp.ok ? "ok" : "error", latencyMs };
  } catch (err: any) {
    return { status: "error", error: err.message?.slice(0, 200) };
  }
}

async function checkGoogleMaps(): Promise<ServiceCheckResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { status: "not_configured" };

  try {
    const start = Date.now();
    // Geocode a known address as connectivity test
    const resp = await fetchWithTimeout(
      `https://maps.googleapis.com/maps/api/geocode/json?address=1600+Amphitheatre+Parkway&key=${apiKey}`,
      {},
      5000,
    );
    const latencyMs = Date.now() - start;
    if (resp.ok) {
      const data = await resp.json();
      return { status: data.status === "OK" ? "ok" : "error", latencyMs };
    }
    return { status: "error", latencyMs };
  } catch (err: any) {
    return { status: "error", error: err.message?.slice(0, 200) };
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
