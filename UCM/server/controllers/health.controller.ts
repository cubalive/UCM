import type { Request, Response } from "express";
import type { AuthRequest } from "../auth";
import { db, pool, getDbSource, getDbHost, getDbPort } from "../db";
import { sql } from "drizzle-orm";

export const APP_VERSION = process.env.UCM_BUILD_VERSION || process.env.BUILD_VERSION || "dev";
export const APP_BUILD_TIME = process.env.UCM_BUILD_TIME || new Date().toISOString();
const APP_ENV = process.env.NODE_ENV || "development";

export async function healthz(_req: Request, res: Response) {
  const start = Date.now();
  let dbOk = false;
  let dbLatencyMs = 0;

  try {
    const dbStart = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - dbStart;
    dbOk = true;
  } catch {}

  let redisStatus: any = { status: "not_checked" };
  try {
    const { pingRedis, isRedisConnected } = await import("../lib/redis");
    if (isRedisConnected()) {
      const pingResult = await pingRedis();
      redisStatus = { status: pingResult.ok ? "connected" : "error", latencyMs: pingResult.latencyMs };
    } else {
      redisStatus = { status: "not_configured" };
    }
  } catch (err: any) {
    redisStatus = { status: "error", error: err.message };
  }

  let schedulers: any = {};
  let roleMode = "all";
  let leader: any = {};
  let circuitBreakers: any = {};
  try {
    const { getSchedulerStates } = await import("../lib/schedulerHarness");
    schedulers = getSchedulerStates();
    const { getRoleMode } = await import("../lib/schedulerInit");
    roleMode = getRoleMode();
    const { getLeaderInfo } = await import("../lib/leaderElection");
    leader = await getLeaderInfo();
    const { getCircuitBreakerStates } = await import("../lib/circuitBreaker");
    circuitBreakers = getCircuitBreakerStates();
  } catch {}

  const mem = process.memoryUsage();
  const ok = dbOk;
  res.status(ok ? 200 : 503).json({
    ok,
    version: APP_VERSION,
    builtAt: APP_BUILD_TIME,
    env: APP_ENV,
    roleMode,
    uptime: Math.round(process.uptime()),
    pid: process.pid,
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    db: {
      status: dbOk ? "connected" : "disconnected",
      source: getDbSource(),
      latencyMs: dbLatencyMs,
    },
    redis: redisStatus,
    leader,
    schedulers,
    circuitBreakers,
    timestamp: new Date().toISOString(),
  });
}

export async function readyz(_req: Request, res: Response) {
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
    ready,
    db: dbOk,
    redis: redisOk,
    uptime: Math.round(process.uptime()),
  });
}

export async function versionHandler(_req: Request, res: Response) {
  res.json({
    version: APP_VERSION,
    builtAt: APP_BUILD_TIME,
    env: APP_ENV,
  });
}

export async function healthLegacy(_req: Request, res: Response) {
  let dbStatus = "disconnected";

  try {
    const { pool } = await import("../db");
    await pool.query("SELECT 1");
    dbStatus = "connected";
  } catch {}

  let supabaseStatus = "not_configured";
  try {
    const { getSupabaseServer } = await import("../../lib/supabaseClient");
    const sbServer = getSupabaseServer();
    if (sbServer) {
      const { error } = await sbServer.from("cities").select("id").limit(1);
      supabaseStatus = error ? `error: ${error.message}` : "connected";
    }
  } catch (e: any) {
    supabaseStatus = `error: ${e.message}`;
  }

  const ok = dbStatus === "connected";
  res.status(ok ? 200 : 500).json({
    ok,
    db: dbStatus,
    supabase: supabaseStatus,
    version: APP_VERSION,
  });
}

export async function healthDetailedHandler(_req: AuthRequest, res: Response) {
  const start = Date.now();
  const checks: Record<string, any> = {};

  try {
    const dbStart = Date.now();
    await db.execute(sql`SELECT 1`);
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart, source: getDbSource() };
  } catch (err: any) {
    checks.database = { status: "error", error: err.message };
  }

  try {
    const { pingRedis, isRedisConnected, getRedisMetrics } = await import("../lib/redis");
    if (isRedisConnected()) {
      const pingResult = await pingRedis();
      checks.redis = { status: pingResult.ok ? "ok" : "error", latencyMs: pingResult.latencyMs, metrics: getRedisMetrics() };
    } else {
      checks.redis = { status: "not_configured" };
    }
  } catch (err: any) {
    checks.redis = { status: "error", error: err.message };
  }

  checks.googleMaps = {
    serverKeyConfigured: !!process.env.GOOGLE_MAPS_API_KEY,
    browserKeyConfigured: !!process.env.VITE_GOOGLE_MAPS_KEY || !!process.env.GOOGLE_MAPS_API_KEY,
  };

  checks.featureFlags = {
    geofenceEnabled: process.env.GEOFENCE_ENABLED === "true",
    geofencePickupRadiusM: parseInt(process.env.GEOFENCE_PICKUP_RADIUS_METERS || "120"),
    geofenceDropoffRadiusM: parseInt(process.env.GEOFENCE_DROPOFF_RADIUS_METERS || "160"),
    smsReminderEnabled: process.env.SMS_REMINDER_ENABLED === "true",
    driverDeviceBinding: process.env.DRIVER_DEVICE_BINDING === "true",
  };

  checks.services = {
    twilioConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
  };

  const allOk = checks.database?.status === "ok";
  res.status(allOk ? 200 : 503).json({
    ok: allOk,
    version: APP_VERSION,
    uptime: process.uptime(),
    checks,
    totalLatencyMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
}

export async function healthDbDetails(_req: AuthRequest, res: Response) {
  const sanitizedHost = (() => {
    const h = getDbHost();
    if (h.length <= 14) return h;
    return h.replace(/^(.{6}).*(.{6})$/, "$1***$2");
  })();

  let pgCurrentDb: string | null = null;
  let pgVersion: string | null = null;
  let dbOk = false;
  let latencyMs = 0;

  try {
    const start = Date.now();
    const client = await pool.connect();
    const dbRes = await client.query("SELECT current_database() AS db, version() AS ver");
    client.release();
    latencyMs = Date.now() - start;
    dbOk = true;
    pgCurrentDb = dbRes.rows[0]?.db || null;
    pgVersion = dbRes.rows[0]?.ver || null;
  } catch (err: any) {
    pgCurrentDb = `error: ${err.message}`;
  }

  res.json({
    ok: dbOk,
    db: {
      source: getDbSource(),
      host: sanitizedHost,
      port: getDbPort(),
      currentDatabase: pgCurrentDb,
      pgVersion,
      latencyMs,
    },
    flags: {
      hasDatabaseUrl: !!(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL),
      source: process.env.SUPABASE_DB_URL ? "SUPABASE_DB_URL" : "DATABASE_URL",
    },
    timestamp: new Date().toISOString(),
  });
}

export function pwaHealth(_req: Request, res: Response) {
  res.json({
    ok: true,
    pwa: true,
    serviceWorker: "sw.js",
    manifest: "/manifest.json",
    timestamp: new Date().toISOString(),
  });
}

export function crashSimulation(req: Request, res: Response) {
  if (APP_ENV === "production") {
    return res.status(403).json({ error: "Crash simulation disabled in production" });
  }

  const type = (req.query.type as string) || "rejection";

  switch (type) {
    case "rejection":
      Promise.reject(new Error("[CRASH-SIM] Controlled unhandled rejection test"));
      res.json({ triggered: "unhandledRejection", recovered: true, ts: new Date().toISOString() });
      break;

    case "throw":
      setTimeout(() => {
        throw new Error("[CRASH-SIM] Controlled uncaught exception test — should trigger graceful shutdown");
      }, 100);
      res.json({ triggered: "uncaughtException", note: "Process will attempt graceful shutdown in 100ms", ts: new Date().toISOString() });
      break;

    case "oom":
      res.json({ error: "OOM simulation disabled for safety", ts: new Date().toISOString() });
      break;

    default:
      res.json({
        available: ["rejection", "throw", "oom"],
        usage: "/api/dev/crash?type=rejection",
        ts: new Date().toISOString(),
      });
  }
}
