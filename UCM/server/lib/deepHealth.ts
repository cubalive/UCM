import { db, pool } from "../db";
import { jobs } from "@shared/schema";
import { eq, and, gte, sql, or } from "drizzle-orm";
import { pingRedis, isRedisConnected, getJson, setJson } from "./redis";

const WORKER_HEARTBEAT_KEY = "worker:heartbeat";
const WORKER_STALE_THRESHOLD_S = 60;
const FAILED_JOBS_SPIKE_THRESHOLD = 10;
const HIGH_QUEUE_LAG_S = 120;

export async function setWorkerHeartbeat(): Promise<void> {
  const data = { lastBeatAt: new Date().toISOString(), pid: process.pid };
  await setJson(WORKER_HEARTBEAT_KEY, data, 120);
}

export async function getWorkerHeartbeat(): Promise<{ lastBeatAt: string; pid: number } | null> {
  return getJson<{ lastBeatAt: string; pid: number }>(WORKER_HEARTBEAT_KEY);
}

interface HealthCheck {
  ok: boolean;
  latencyMs: number;
  details: string;
  lastUpdated: string;
}

interface DeepHealthResult {
  status: "GREEN" | "YELLOW" | "RED";
  checks: {
    db: HealthCheck;
    redis: HealthCheck;
    worker: HealthCheck;
    queue: HealthCheck;
  };
}

export async function runDeepHealth(): Promise<DeepHealthResult> {
  const now = new Date().toISOString();
  const checks = {
    db: await checkDb(now),
    redis: await checkRedis(now),
    worker: await checkWorker(now),
    queue: await checkQueue(now),
  };

  let status: "GREEN" | "YELLOW" | "RED" = "GREEN";

  if (!checks.db.ok) status = "RED";
  if (!checks.worker.ok && status !== "RED") {
    const hb = await getWorkerHeartbeat();
    if (!hb) {
      status = "RED";
    } else {
      const staleSec = (Date.now() - new Date(hb.lastBeatAt).getTime()) / 1000;
      if (staleSec > WORKER_STALE_THRESHOLD_S) status = "RED";
    }
  }

  const queueDetails = checks.queue.details;
  if (queueDetails.includes("failed_spike")) {
    status = "RED";
  }

  if (status === "GREEN") {
    if (checks.db.latencyMs > 500) status = "YELLOW";
    if (!checks.redis.ok) status = "YELLOW";
    if (queueDetails.includes("high_lag")) status = "YELLOW";
  }

  return { status, checks };
}

async function checkDb(now: string): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await pool.query("SELECT 1");
    const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000);
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(gte(jobs.createdAt, fifteenAgo));
    const recentJobs = countResult[0]?.count ?? 0;
    return {
      ok: true,
      latencyMs: Date.now() - start,
      details: `connected, ${recentJobs} jobs in last 15min`,
      lastUpdated: now,
    };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      details: `error: ${err.message}`,
      lastUpdated: now,
    };
  }
}

async function checkRedis(now: string): Promise<HealthCheck> {
  const start = Date.now();
  if (!isRedisConnected()) {
    return {
      ok: false,
      latencyMs: 0,
      details: "not configured, using in-memory fallback",
      lastUpdated: now,
    };
  }
  try {
    const ping = await pingRedis();
    if (!ping.ok) {
      return {
        ok: false,
        latencyMs: ping.latencyMs,
        details: `ping failed: ${ping.error}`,
        lastUpdated: now,
      };
    }
    const testKey = `health:check:${Date.now()}`;
    await setJson(testKey, { t: 1 }, 10);
    const got = await getJson<{ t: number }>(testKey);
    return {
      ok: got?.t === 1,
      latencyMs: Date.now() - start,
      details: got?.t === 1 ? "ping ok, set/get ok" : "ping ok, set/get mismatch",
      lastUpdated: now,
    };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      details: `error: ${err.message}`,
      lastUpdated: now,
    };
  }
}

async function checkWorker(now: string): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const hb = await getWorkerHeartbeat();
    if (!hb) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        details: "no heartbeat found, worker may not be running",
        lastUpdated: now,
      };
    }
    const staleSec = (Date.now() - new Date(hb.lastBeatAt).getTime()) / 1000;
    const stale = staleSec > WORKER_STALE_THRESHOLD_S;

    const queuedRows = await db
      .select({ oldest: sql<Date>`min(created_at)` })
      .from(jobs)
      .where(eq(jobs.status, "queued"));
    const oldest = queuedRows[0]?.oldest;
    const lagSec = oldest ? (Date.now() - new Date(oldest).getTime()) / 1000 : 0;

    return {
      ok: !stale,
      latencyMs: Date.now() - start,
      details: stale
        ? `stale heartbeat (${Math.round(staleSec)}s ago), queueLag=${Math.round(lagSec)}s`
        : `heartbeat ${Math.round(staleSec)}s ago, pid=${hb.pid}, queueLag=${Math.round(lagSec)}s`,
      lastUpdated: now,
    };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      details: `error: ${err.message}`,
      lastUpdated: now,
    };
  }
}

async function checkQueue(now: string): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000);
    const rows = await db
      .select({
        status: jobs.status,
        count: sql<number>`count(*)::int`,
      })
      .from(jobs)
      .where(gte(jobs.createdAt, fifteenAgo))
      .groupBy(jobs.status);

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = r.count;

    const queued = counts["queued"] || 0;
    const working = counts["working"] || 0;
    const failed = counts["failed"] || 0;
    const succeeded = counts["succeeded"] || 0;

    const oldestQueuedResult = await db
      .select({ oldest: sql<Date>`min(created_at)` })
      .from(jobs)
      .where(eq(jobs.status, "queued"));
    const oldest = oldestQueuedResult[0]?.oldest;
    const oldestAgeSec = oldest ? Math.round((Date.now() - new Date(oldest).getTime()) / 1000) : 0;

    const flags: string[] = [];
    if (failed > FAILED_JOBS_SPIKE_THRESHOLD) flags.push("failed_spike");
    if (oldestAgeSec > HIGH_QUEUE_LAG_S) flags.push("high_lag");

    return {
      ok: flags.length === 0,
      latencyMs: Date.now() - start,
      details: `15min: queued=${queued} working=${working} succeeded=${succeeded} failed=${failed} oldestAge=${oldestAgeSec}s ${flags.join(" ")}`.trim(),
      lastUpdated: now,
    };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      details: `error: ${err.message}`,
      lastUpdated: now,
    };
  }
}
