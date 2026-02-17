import { storage } from "../storage";
import { setJson, getJson, isRedisConnected } from "./redis";
import { cache } from "./cache";
import { getRequestMetricsSummary } from "./requestMetrics";
import type { Trip, Driver } from "@shared/schema";

const ENGINE_INTERVAL_MS = 60_000;
const SENTINEL_INTERVAL_MS = 15_000;
const CACHE_KEY = "ai_engine:snapshot";
const CACHE_TTL_SECONDS = 55;
const TRIP_LOOKBACK_MINUTES = 30;
const DRIVER_LOOKBACK_MINUTES = 10;
const WARN_RUNTIME_MS = 5_000;
const CRITICAL_RUNTIME_MS = 10_000;
const THROTTLED_INTERVAL_MS = 120_000;

type EngineStatus = "OK" | "SLOW" | "THROTTLED";

interface RiskItem {
  code: string;
  severity: "critical" | "warning";
  title: string;
  count: number;
}

interface EngineSnapshot {
  computedAt: string;
  runtimeMs: number;
  engineStatus: EngineStatus;
  tripsAnalyzed: number;
  driversAnalyzed: number;
  metrics: {
    totalTripsToday: number;
    activeTrips: number;
    completedTrips: number;
    cancelledTrips: number;
    noShowTrips: number;
    scheduledTrips: number;
    assignedTrips: number;
    unassignedTrips: number;
    driversOnline: number;
    driversAvailable: number;
    driversOnTrip: number;
    driversOff: number;
    todayRevenueDelta: number;
    avgTripDurationMins: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    errorRatePct: number;
    requestsPerMin: number;
  };
  topRisks: RiskItem[];
  forecast: {
    projectedTripsRemaining: number;
    driverUtilizationPct: number;
    estimatedCompletionTime: string | null;
    capacityStatus: "ok" | "tight" | "overloaded";
  };
}

let engineInterval: ReturnType<typeof setInterval> | null = null;
let sentinelInterval: ReturnType<typeof setInterval> | null = null;
let engineStatus: EngineStatus = "OK";
let lastRuntimeMs = 0;
let lastSnapshotSize = 0;
let lastRunAt: string | null = null;
let skipNextCycle = false;
let currentIntervalMs = ENGINE_INTERVAL_MS;
let consecutiveSlowRuns = 0;
let totalRuns = 0;
let totalRuntimeMs = 0;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function tripTimeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length < 2) return null;
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

async function computeSnapshot(): Promise<EngineSnapshot> {
  const start = Date.now();
  const today = todayStr();
  const nowMins = nowMinutes();

  const tripsSince = new Date(Date.now() - TRIP_LOOKBACK_MINUTES * 60_000);
  const driversSince = new Date(Date.now() - DRIVER_LOOKBACK_MINUTES * 60_000);

  const [recentTrips, recentDrivers, cities] = await Promise.all([
    storage.getRecentTripsUpdatedSince(tripsSince),
    storage.getRecentDriversUpdatedSince(driversSince),
    storage.getActiveCities(),
  ]);

  const todayTrips = recentTrips.filter(t => t.scheduledDate === today);

  const activeTrips = todayTrips.filter(t =>
    t.approvalStatus !== "cancelled" && t.status !== "CANCELLED"
  );
  const completedTrips = todayTrips.filter(t => t.status === "COMPLETED");
  const cancelledTrips = todayTrips.filter(t => t.status === "CANCELLED" || t.approvalStatus === "cancelled");
  const noShowTrips = todayTrips.filter(t => t.status === "NO_SHOW");
  const scheduledTrips = activeTrips.filter(t => t.status === "SCHEDULED");
  const assignedTrips = activeTrips.filter(t => t.status === "ASSIGNED");
  const inProgressTrips = activeTrips.filter(t => t.status === "IN_PROGRESS");
  const unassignedTrips = activeTrips.filter(t => !t.driverId && t.status !== "COMPLETED" && t.status !== "CANCELLED" && t.status !== "NO_SHOW");

  const activeDrivers = recentDrivers.filter(d => d.active && !d.deletedAt && d.status === "ACTIVE");
  const onlineDrivers = activeDrivers.filter(d => d.dispatchStatus === "available" || d.dispatchStatus === "on_trip");
  const availableDrivers = activeDrivers.filter(d => d.dispatchStatus === "available");
  const onTripDrivers = activeDrivers.filter(d => d.dispatchStatus === "on_trip");
  const offDrivers = activeDrivers.filter(d => d.dispatchStatus === "off" || !d.dispatchStatus);

  const completedWithDuration = completedTrips.filter(t => {
    const pickup = tripTimeToMinutes(t.pickupTime || t.scheduledTime);
    const dropoff = tripTimeToMinutes(t.completedAt ? new Date(t.completedAt).getHours() + ":" + new Date(t.completedAt).getMinutes() : null);
    return pickup != null && dropoff != null;
  });
  const avgDuration = completedWithDuration.length > 0
    ? Math.round(completedTrips.reduce((s, t) => {
        const dur = t.distanceMiles ? parseFloat(t.distanceMiles) * 2.5 : 30;
        return s + dur;
      }, 0) / completedTrips.length)
    : 0;

  const todayRevenueDelta = completedTrips.reduce((s, t) => {
    const price = t.price ? parseFloat(t.price) : 0;
    return s + price;
  }, 0);

  const reqMetrics = getRequestMetricsSummary();

  const risks: RiskItem[] = [];

  const upcomingNoDriver = activeTrips.filter(t => {
    if (t.driverId) return false;
    if (t.status === "COMPLETED" || t.status === "CANCELLED" || t.status === "NO_SHOW") return false;
    const pickupMins = tripTimeToMinutes(t.pickupTime || t.scheduledTime);
    if (pickupMins == null) return false;
    return pickupMins - nowMins <= 60 && pickupMins - nowMins >= 0;
  });
  if (upcomingNoDriver.length > 0) {
    risks.push({ code: "TRIPS_NO_DRIVER_60MIN", severity: "critical", title: "Trips without driver (next 60 min)", count: upcomingNoDriver.length });
  }

  const lateTrips = inProgressTrips.filter(t => {
    const pickupMins = tripTimeToMinutes(t.pickupTime || t.scheduledTime);
    if (pickupMins == null) return false;
    return nowMins > pickupMins + 15;
  });
  if (lateTrips.length > 0) {
    risks.push({ code: "TRIPS_RUNNING_LATE", severity: "critical", title: "Trips running > 15 min late", count: lateTrips.length });
  }

  const STALE_GPS_MS = 5 * 60_000;
  const staleGps = onlineDrivers.filter(d => {
    if (!d.lastSeenAt) return true;
    return (Date.now() - new Date(d.lastSeenAt).getTime()) > STALE_GPS_MS;
  });
  if (staleGps.length > 0) {
    risks.push({ code: "STALE_DRIVER_GPS", severity: "warning", title: "Online drivers with stale GPS", count: staleGps.length });
  }

  if (noShowTrips.length >= 3) {
    risks.push({ code: "HIGH_NO_SHOW_RATE", severity: "warning", title: "Elevated no-show count today", count: noShowTrips.length });
  }

  if (reqMetrics.error_rate_pct > 5) {
    risks.push({ code: "HIGH_ERROR_RATE", severity: "critical", title: "API error rate > 5%", count: Math.round(reqMetrics.error_rate_pct) });
  }

  risks.sort((a, b) => {
    if (a.severity === "critical" && b.severity !== "critical") return -1;
    if (a.severity !== "critical" && b.severity === "critical") return 1;
    return b.count - a.count;
  });

  const remainingTrips = scheduledTrips.length + assignedTrips.length + inProgressTrips.length;
  const totalDriverCap = Math.max(availableDrivers.length + onTripDrivers.length, 1);
  const utilizationPct = Math.round((onTripDrivers.length / totalDriverCap) * 100);
  let capacityStatus: "ok" | "tight" | "overloaded" = "ok";
  if (remainingTrips > totalDriverCap * 3) capacityStatus = "overloaded";
  else if (remainingTrips > totalDriverCap * 1.5) capacityStatus = "tight";

  let estimatedCompletionTime: string | null = null;
  if (remainingTrips > 0 && avgDuration > 0 && totalDriverCap > 0) {
    const minutesNeeded = (remainingTrips * avgDuration) / totalDriverCap;
    const completionDate = new Date(Date.now() + minutesNeeded * 60_000);
    estimatedCompletionTime = completionDate.toISOString();
  }

  const runtimeMs = Date.now() - start;

  return {
    computedAt: new Date().toISOString(),
    runtimeMs,
    engineStatus,
    tripsAnalyzed: todayTrips.length,
    driversAnalyzed: activeDrivers.length,
    metrics: {
      totalTripsToday: todayTrips.length,
      activeTrips: activeTrips.length,
      completedTrips: completedTrips.length,
      cancelledTrips: cancelledTrips.length,
      noShowTrips: noShowTrips.length,
      scheduledTrips: scheduledTrips.length,
      assignedTrips: assignedTrips.length,
      unassignedTrips: unassignedTrips.length,
      driversOnline: onlineDrivers.length,
      driversAvailable: availableDrivers.length,
      driversOnTrip: onTripDrivers.length,
      driversOff: offDrivers.length,
      todayRevenueDelta: Math.round(todayRevenueDelta * 100) / 100,
      avgTripDurationMins: avgDuration,
      p50LatencyMs: reqMetrics.p50_latency_ms,
      p95LatencyMs: reqMetrics.p95_latency_ms,
      errorRatePct: reqMetrics.error_rate_pct,
      requestsPerMin: reqMetrics.rpm_1min ?? 0,
    },
    topRisks: risks.slice(0, 5),
    forecast: {
      projectedTripsRemaining: remainingTrips,
      driverUtilizationPct: utilizationPct,
      estimatedCompletionTime,
      capacityStatus,
    },
  };
}

async function runEngineCycle(): Promise<void> {
  if (skipNextCycle) {
    skipNextCycle = false;
    console.log("[AI-ENGINE] Skipping cycle (previous run was slow)");
    return;
  }

  const cycleStart = Date.now();
  try {
    const snapshot = await computeSnapshot();
    const runtimeMs = Date.now() - cycleStart;
    snapshot.runtimeMs = runtimeMs;

    lastRuntimeMs = runtimeMs;
    lastRunAt = snapshot.computedAt;
    totalRuns++;
    totalRuntimeMs += runtimeMs;

    const snapshotJson = JSON.stringify(snapshot);
    lastSnapshotSize = snapshotJson.length;

    try {
      await setJson(CACHE_KEY, snapshot, CACHE_TTL_SECONDS);
    } catch {
      cache.set(CACHE_KEY, snapshot, CACHE_TTL_SECONDS * 1000);
    }

    await storage.createAiEngineSnapshot({
      runtimeMs,
      engineStatus: snapshot.engineStatus,
      tripsAnalyzed: snapshot.tripsAnalyzed,
      driversAnalyzed: snapshot.driversAnalyzed,
      metrics: snapshot.metrics,
      topRisks: snapshot.topRisks,
      forecast: snapshot.forecast,
    });

    if (runtimeMs > CRITICAL_RUNTIME_MS) {
      engineStatus = "THROTTLED";
      consecutiveSlowRuns++;
      skipNextCycle = true;
      console.warn(`[AI-ENGINE] CRITICAL: runtime ${runtimeMs}ms > ${CRITICAL_RUNTIME_MS}ms. Auto-throttling to ${THROTTLED_INTERVAL_MS / 1000}s.`);
      restartWithInterval(THROTTLED_INTERVAL_MS);
    } else if (runtimeMs > WARN_RUNTIME_MS) {
      engineStatus = "SLOW";
      consecutiveSlowRuns++;
      skipNextCycle = true;
      console.warn(`[AI-ENGINE] WARNING: runtime ${runtimeMs}ms > ${WARN_RUNTIME_MS}ms. Skipping next cycle.`);
    } else {
      if (consecutiveSlowRuns > 0 && currentIntervalMs > ENGINE_INTERVAL_MS) {
        console.log(`[AI-ENGINE] Runtime normalized (${runtimeMs}ms). Restoring 60s interval.`);
        restartWithInterval(ENGINE_INTERVAL_MS);
      }
      engineStatus = "OK";
      consecutiveSlowRuns = 0;
    }

    console.log(`[AI-ENGINE] Cycle complete: ${runtimeMs}ms, ${snapshot.tripsAnalyzed} trips, ${snapshot.driversAnalyzed} drivers, status=${engineStatus}`);
  } catch (err: any) {
    console.error(`[AI-ENGINE] Cycle error: ${err.message}`);
  }
}

function restartWithInterval(intervalMs: number) {
  if (engineInterval) {
    clearInterval(engineInterval);
  }
  currentIntervalMs = intervalMs;
  engineInterval = setInterval(runEngineCycle, intervalMs);
}

async function runSentinelCheck(): Promise<void> {
  try {
    const cached = await getCachedSnapshot();
    if (!cached) return;

    if (cached.topRisks.some(r => r.severity === "critical" && r.code === "TRIPS_NO_DRIVER_60MIN")) {
      console.log(`[AI-SENTINEL] CRITICAL: ${cached.topRisks.find(r => r.code === "TRIPS_NO_DRIVER_60MIN")?.count} trips without driver in next 60 min`);
    }

    if (cached.metrics.errorRatePct > 10) {
      console.warn(`[AI-SENTINEL] CRITICAL: API error rate at ${cached.metrics.errorRatePct}%`);
    }
  } catch (err: any) {
    console.error(`[AI-SENTINEL] Check error: ${err.message}`);
  }
}

export async function getCachedSnapshot(): Promise<EngineSnapshot | null> {
  try {
    const fromRedis = await getJson<EngineSnapshot>(CACHE_KEY);
    if (fromRedis) return fromRedis;
  } catch {}

  const fromMemory = cache.get<EngineSnapshot>(CACHE_KEY);
  if (fromMemory) return fromMemory;

  return null;
}

export function getEngineStatus() {
  return {
    engineStatus,
    lastRuntimeMs,
    lastSnapshotSize,
    lastRunAt,
    intervalMs: currentIntervalMs,
    skipNextCycle,
    totalRuns,
    avgRuntimeMs: totalRuns > 0 ? Math.round(totalRuntimeMs / totalRuns) : 0,
    consecutiveSlowRuns,
  };
}

export function startAiEngine() {
  if (engineInterval) return;

  console.log(`[AI-ENGINE] Starting (interval: ${ENGINE_INTERVAL_MS / 1000}s, sentinel: ${SENTINEL_INTERVAL_MS / 1000}s)`);

  setTimeout(() => runEngineCycle(), 5_000);

  engineInterval = setInterval(runEngineCycle, ENGINE_INTERVAL_MS);
  sentinelInterval = setInterval(runSentinelCheck, SENTINEL_INTERVAL_MS);
}

export function stopAiEngine() {
  if (engineInterval) {
    clearInterval(engineInterval);
    engineInterval = null;
  }
  if (sentinelInterval) {
    clearInterval(sentinelInterval);
    sentinelInterval = null;
  }
  console.log("[AI-ENGINE] Stopped");
}
