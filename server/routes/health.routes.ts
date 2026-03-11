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

  app.get("/api/health/live", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "alive",
      uptime: Math.round(process.uptime()),
      pid: process.pid,
    });
  });
}
