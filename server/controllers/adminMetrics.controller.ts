import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { pool } from "../db";
import { getRequestMetricsSummary, getTopRoutes } from "../lib/requestMetrics";
import {
  evaluateDbLatency,
  evaluateApiP95,
  evaluateErrorRate,
  evaluateImportFailRate,
  evaluateSmsFailRate,
  evaluateDriverStale,
  evaluateTrips,
  worstState,
  getThresholds,
  type HealthState,
} from "../lib/healthEvaluator";

let cachedSummary: { data: any; ts: number } | null = null;
const CACHE_TTL_MS = 15_000;

async function safeQuery(sql: string, params: any[] = [], timeoutMs = 2000): Promise<any[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = $1`, [timeoutMs]);
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export async function metricsSummary(_req: AuthRequest, res: Response) {
  if (cachedSummary && Date.now() - cachedSummary.ts < CACHE_TTL_MS) {
    return res.json(cachedSummary.data);
  }

  try {
    const dbStart = Date.now();
    await safeQuery("SELECT 1");
    const dbLatencyMs = Date.now() - dbStart;
    const dbHealth = evaluateDbLatency(dbLatencyMs);

    const apiStats = getRequestMetricsSummary();
    const apiP95Health = evaluateApiP95(apiStats.p95_latency_ms);
    const errorRateDecimal = apiStats.total_requests_5min > 0
      ? apiStats.total_errors_5min / apiStats.total_requests_5min
      : 0;
    const errorHealth = evaluateErrorRate(errorRateDecimal);
    const apiState = worstState([apiP95Health.state, errorHealth.state]);

    const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let importData = { last24hJobs: 0, failRate: 0, lastJobStatus: "none" as string };
    try {
      const importRows = await safeQuery(
        `SELECT status, COUNT(*)::int AS cnt FROM import_jobs WHERE created_at >= $1 GROUP BY status`,
        [now24h]
      );
      let total = 0, failed = 0;
      let lastStatus = "none";
      for (const r of importRows) {
        total += r.cnt;
        if (r.status === "failed" || r.status === "error") failed += r.cnt;
        lastStatus = r.status;
      }
      importData = { last24hJobs: total, failRate: total > 0 ? failed / total : 0, lastJobStatus: lastStatus };
    } catch {}
    const importHealth = evaluateImportFailRate(importData.failRate, importData.last24hJobs);

    let tripData = { activeTrips: 0, scheduledNext24h: 0, latePickups: 0, noShows: 0 };
    try {
      const activeStatuses = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "IN_PROGRESS", "EN_ROUTE_TO_DROPOFF"];
      const activeRows = await safeQuery(
        `SELECT COUNT(*)::int AS cnt FROM trips WHERE status = ANY($1)`,
        [activeStatuses]
      );
      tripData.activeTrips = activeRows[0]?.cnt || 0;

      const next24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const schedRows = await safeQuery(
        `SELECT COUNT(*)::int AS cnt FROM trips WHERE status = 'SCHEDULED' AND scheduled_date BETWEEN $1 AND $2`,
        [today, next24h]
      );
      tripData.scheduledNext24h = schedRows[0]?.cnt || 0;

      const noShowRows = await safeQuery(
        `SELECT COUNT(*)::int AS cnt FROM trips WHERE status = 'NO_SHOW' AND updated_at >= $1`,
        [now24h]
      );
      tripData.noShows = noShowRows[0]?.cnt || 0;

      const lateRows = await safeQuery(
        `SELECT COUNT(*)::int AS cnt FROM trips WHERE status IN ('SCHEDULED','ASSIGNED') AND scheduled_date < $1`,
        [today]
      );
      tripData.latePickups = lateRows[0]?.cnt || 0;
    } catch {}
    const tripHealth = evaluateTrips(tripData.latePickups, tripData.noShows);

    let driverData = { activeDrivers: 0, staleLocationCount: 0 };
    try {
      const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const driverRows = await safeQuery(
        `SELECT 
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE last_seen_at IS NULL OR last_seen_at < $1)::int AS stale
         FROM drivers WHERE status = 'active'`,
        [staleThreshold]
      );
      driverData.activeDrivers = driverRows[0]?.total || 0;
      driverData.staleLocationCount = driverRows[0]?.stale || 0;
    } catch {}
    const driverHealth = evaluateDriverStale(driverData.staleLocationCount, driverData.activeDrivers);

    let smsData = { smsSent24h: 0, smsFailRate: 0 };
    try {
      const smsRows = await safeQuery(
        `SELECT 
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE error IS NOT NULL AND error != '')::int AS failed
         FROM trip_sms_log WHERE sent_at >= $1`,
        [now24h]
      );
      const total = smsRows[0]?.total || 0;
      const failed = smsRows[0]?.failed || 0;
      smsData = { smsSent24h: total, smsFailRate: total > 0 ? failed / total : 0 };
    } catch {}
    const smsHealth = evaluateSmsFailRate(smsData.smsFailRate, smsData.smsSent24h);

    const allStates: HealthState[] = [
      dbHealth.state, apiState, importHealth.state,
      tripHealth.state, driverHealth.state, smsHealth.state,
    ];
    const overallState = worstState(allStates);

    const result = {
      ok: true,
      overallState,
      timestamp: new Date().toISOString(),
      thresholds: getThresholds(),
      db: { latencyMs: dbLatencyMs, ...dbHealth },
      api: {
        p95Ms: apiStats.p95_latency_ms,
        errorRate: errorRateDecimal,
        totalRequests5min: apiStats.total_requests_5min,
        rpm: apiStats.rpm_5min,
        errors5xx: apiStats.errors_5xx_5min,
        state: apiState,
        reason: `${apiP95Health.reason}; ${errorHealth.reason}`,
      },
      imports: {
        ...importData,
        ...importHealth,
      },
      trips: {
        ...tripData,
        ...tripHealth,
      },
      drivers: {
        ...driverData,
        ...driverHealth,
      },
      notifications: {
        ...smsData,
        ...smsHealth,
      },
    };

    cachedSummary = { data: result, ts: Date.now() };
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function metricsDetails(_req: AuthRequest, res: Response) {
  try {
    const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const topRoutes = getTopRoutes(20);

    let recentImports: any[] = [];
    try {
      recentImports = await safeQuery(
        `SELECT id, company_id, source_system, status, summary_json, created_at
         FROM import_jobs ORDER BY created_at DESC LIMIT 20`
      );
    } catch {}

    let lateTrips: any[] = [];
    try {
      const today = new Date().toISOString().slice(0, 10);
      lateTrips = await safeQuery(
        `SELECT id, public_id, company_id, clinic_id, scheduled_date, pickup_time, status
         FROM trips WHERE status IN ('SCHEDULED','ASSIGNED') AND scheduled_date < $1
         ORDER BY scheduled_date DESC LIMIT 50`,
        [today]
      );
    } catch {}

    let staleDrivers: any[] = [];
    try {
      const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      staleDrivers = await safeQuery(
        `SELECT id, company_id, first_name, last_name, last_seen_at
         FROM drivers WHERE status = 'active' AND (last_seen_at IS NULL OR last_seen_at < $1)
         ORDER BY last_seen_at ASC NULLS FIRST LIMIT 50`,
        [staleThreshold]
      );
    } catch {}

    let recentSmsErrors: any[] = [];
    try {
      recentSmsErrors = await safeQuery(
        `SELECT id, trip_id, kind, error, sent_at
         FROM trip_sms_log WHERE error IS NOT NULL AND error != '' AND sent_at >= $1
         ORDER BY sent_at DESC LIMIT 30`,
        [now24h]
      );
    } catch {}

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      topRoutes,
      recentImports,
      lateTrips,
      staleDrivers,
      recentSmsErrors,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
