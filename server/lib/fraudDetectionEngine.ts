/**
 * Fraud Detection Engine
 *
 * Detects suspicious patterns in trips and billing data:
 *   - Duplicate trips (same patient, time, destination)
 *   - Impossible distances (claimed miles >> actual route)
 *   - Ghost trips (no GPS data during trip)
 *   - Unusual billing patterns (spikes in per-driver revenue)
 *   - Round-trip anomalies (suspiciously identical pickup/dropoff)
 */

import { db } from "../db";
import { trips, drivers, fraudAlerts } from "@shared/schema";
import { eq, and, sql, gte, lte, isNull, desc } from "drizzle-orm";
import { setJson, getJson } from "./redis";
import { cache } from "./cache";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface FraudAlert {
  companyId: number;
  cityId?: number | null;
  tripId?: number | null;
  driverId?: number | null;
  alertType: string;
  severity: Severity;
  description: string;
  details: Record<string, any>;
}

interface FraudScoreResult {
  tripId: number;
  score: number; // 0-100
  factors: { name: string; weight: number; flagged: boolean; detail: string }[];
}

const CACHE_PREFIX = "fraud_detection";
const CACHE_TTL_SECONDS = 600;

// --- Haversine for distance checks ---
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Scan for Fraud ──────────────────────────────────────────────────────────

export async function scanForFraud(
  companyId: number,
  dateRange: { from: string; to: string }
): Promise<FraudAlert[]> {
  const cacheKey = `${CACHE_PREFIX}:scan:${companyId}:${dateRange.from}:${dateRange.to}`;

  try {
    const cached = await getJson<FraudAlert[]>(cacheKey);
    if (cached) return cached;
  } catch {
    const memCached = cache.get<FraudAlert[]>(cacheKey);
    if (memCached) return memCached;
  }

  // Fetch trips in date range
  const tripData = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        gte(trips.scheduledDate, dateRange.from),
        lte(trips.scheduledDate, dateRange.to),
        isNull(trips.deletedAt)
      )
    );

  const alerts: FraudAlert[] = [];

  // 1. Duplicate trip detection
  alerts.push(...detectDuplicates(tripData, companyId));

  // 2. Impossible distance detection
  alerts.push(...detectImpossibleDistances(tripData, companyId));

  // 3. Ghost trip detection (no GPS data)
  alerts.push(...detectGhostTrips(tripData, companyId));

  // 4. Round-trip anomalies
  alerts.push(...detectRoundTripAnomalies(tripData, companyId));

  // 5. Driver revenue spikes
  const revenueAlerts = await detectRevenueSpikes(companyId, dateRange);
  alerts.push(...revenueAlerts);

  // Cache results
  try {
    await setJson(cacheKey, alerts, CACHE_TTL_SECONDS);
  } catch {
    cache.set(cacheKey, alerts, CACHE_TTL_SECONDS * 1000);
  }

  return alerts;
}

// ─── Duplicate Detection ─────────────────────────────────────────────────────

function detectDuplicates(tripData: any[], companyId: number): FraudAlert[] {
  const alerts: FraudAlert[] = [];
  const seen = new Map<string, any[]>();

  for (const t of tripData) {
    // Key: patient + date + pickup time + dropoff address (normalized)
    const key = `${t.patientId}:${t.scheduledDate}:${t.pickupTime}:${(t.dropoffAddress || "").toLowerCase().trim()}`;
    if (!seen.has(key)) {
      seen.set(key, []);
    }
    seen.get(key)!.push(t);
  }

  for (const [, group] of seen) {
    if (group.length > 1) {
      const severity: Severity = group.length >= 3 ? "HIGH" : "MEDIUM";
      alerts.push({
        companyId,
        cityId: group[0].cityId,
        tripId: group[0].id,
        driverId: null,
        alertType: "DUPLICATE_TRIP",
        severity,
        description: `${group.length} duplicate trips found for patient ${group[0].patientId} on ${group[0].scheduledDate} at ${group[0].pickupTime}`,
        details: {
          patientId: group[0].patientId,
          date: group[0].scheduledDate,
          pickupTime: group[0].pickupTime,
          tripIds: group.map((t: any) => t.id),
          count: group.length,
        },
      });
    }
  }

  return alerts;
}

// ─── Impossible Distance Detection ───────────────────────────────────────────

function detectImpossibleDistances(tripData: any[], companyId: number): FraudAlert[] {
  const alerts: FraudAlert[] = [];
  const DISTANCE_RATIO_THRESHOLD = 3.0; // claimed > 3x straight-line is suspicious

  for (const t of tripData) {
    if (!t.distanceMiles || !t.pickupLat || !t.pickupLng || !t.dropoffLat || !t.dropoffLng) continue;

    const claimedMiles = parseFloat(t.distanceMiles);
    if (claimedMiles <= 0) continue;

    const straightLineKm = haversineKm(t.pickupLat, t.pickupLng, t.dropoffLat, t.dropoffLng);
    const straightLineMiles = straightLineKm * 0.621371;

    if (straightLineMiles < 0.5) continue; // too short to evaluate

    const ratio = claimedMiles / straightLineMiles;

    if (ratio > DISTANCE_RATIO_THRESHOLD) {
      const severity: Severity = ratio > 5 ? "CRITICAL" : ratio > 4 ? "HIGH" : "MEDIUM";
      alerts.push({
        companyId,
        cityId: t.cityId,
        tripId: t.id,
        driverId: t.driverId,
        alertType: "IMPOSSIBLE_DISTANCE",
        severity,
        description: `Trip ${t.publicId}: claimed ${claimedMiles.toFixed(1)} miles but straight-line is ${straightLineMiles.toFixed(1)} miles (${ratio.toFixed(1)}x ratio)`,
        details: {
          tripPublicId: t.publicId,
          claimedMiles,
          straightLineMiles: Math.round(straightLineMiles * 10) / 10,
          ratio: Math.round(ratio * 10) / 10,
          pickupAddress: t.pickupAddress,
          dropoffAddress: t.dropoffAddress,
        },
      });
    }
  }

  return alerts;
}

// ─── Ghost Trip Detection ────────────────────────────────────────────────────

function detectGhostTrips(tripData: any[], companyId: number): FraudAlert[] {
  const alerts: FraudAlert[] = [];

  for (const t of tripData) {
    if (t.status !== "COMPLETED") continue;
    if (!t.driverId) continue;

    // Ghost trip indicators:
    // - Completed but no actual distance data
    // - No actual polyline recorded
    // - No started/picked up timestamps
    const hasNoGpsEvidence =
      !t.actualDistanceMeters &&
      !t.actualPolyline &&
      !t.startedAt &&
      !t.pickedUpAt;

    if (hasNoGpsEvidence) {
      alerts.push({
        companyId,
        cityId: t.cityId,
        tripId: t.id,
        driverId: t.driverId,
        alertType: "GHOST_TRIP",
        severity: "HIGH",
        description: `Trip ${t.publicId} completed with no GPS evidence (no tracking data, no timestamps)`,
        details: {
          tripPublicId: t.publicId,
          driverId: t.driverId,
          date: t.scheduledDate,
          hasActualDistance: !!t.actualDistanceMeters,
          hasActualPolyline: !!t.actualPolyline,
          hasStartedAt: !!t.startedAt,
          hasPickedUpAt: !!t.pickedUpAt,
        },
      });
    }
  }

  return alerts;
}

// ─── Round-Trip Anomaly Detection ────────────────────────────────────────────

function detectRoundTripAnomalies(tripData: any[], companyId: number): FraudAlert[] {
  const alerts: FraudAlert[] = [];
  const IDENTICAL_THRESHOLD_KM = 0.1; // ~100 meters

  for (const t of tripData) {
    if (!t.pickupLat || !t.pickupLng || !t.dropoffLat || !t.dropoffLng) continue;

    const distance = haversineKm(t.pickupLat, t.pickupLng, t.dropoffLat, t.dropoffLng);

    if (distance < IDENTICAL_THRESHOLD_KM && t.status === "COMPLETED") {
      // Check if this is a legitimate round trip
      if (t.isRoundTrip || t.pairedTripId) continue;

      alerts.push({
        companyId,
        cityId: t.cityId,
        tripId: t.id,
        driverId: t.driverId,
        alertType: "ROUNDTRIP_ANOMALY",
        severity: "MEDIUM",
        description: `Trip ${t.publicId}: pickup and dropoff are within ${Math.round(distance * 1000)}m of each other`,
        details: {
          tripPublicId: t.publicId,
          distanceMeters: Math.round(distance * 1000),
          pickupAddress: t.pickupAddress,
          dropoffAddress: t.dropoffAddress,
          isRoundTrip: t.isRoundTrip,
        },
      });
    }
  }

  return alerts;
}

// ─── Revenue Spike Detection ─────────────────────────────────────────────────

async function detectRevenueSpikes(
  companyId: number,
  dateRange: { from: string; to: string }
): Promise<FraudAlert[]> {
  const alerts: FraudAlert[] = [];

  // Get per-driver trip counts and revenue in the period
  const driverStats = await db
    .select({
      driverId: trips.driverId,
      cityId: trips.cityId,
      tripCount: sql<number>`count(*)::int`,
      totalRevenue: sql<number>`coalesce(sum(${trips.priceTotalCents}), 0)::int`,
    })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        gte(trips.scheduledDate, dateRange.from),
        lte(trips.scheduledDate, dateRange.to),
        sql`${trips.status} = 'COMPLETED'`,
        sql`${trips.driverId} IS NOT NULL`,
        isNull(trips.deletedAt)
      )
    )
    .groupBy(trips.driverId, trips.cityId);

  if (driverStats.length < 3) return alerts; // need enough data for comparison

  const revenues = driverStats.map((d) => d.totalRevenue);
  const mean = revenues.reduce((a, b) => a + b, 0) / revenues.length;
  const stdDev = Math.sqrt(
    revenues.reduce((s, r) => s + (r - mean) ** 2, 0) / revenues.length
  );

  if (stdDev === 0) return alerts;

  for (const d of driverStats) {
    const zScore = (d.totalRevenue - mean) / stdDev;
    if (zScore > 2.5) {
      const severity: Severity = zScore > 3.5 ? "CRITICAL" : zScore > 3 ? "HIGH" : "MEDIUM";
      alerts.push({
        companyId,
        cityId: d.cityId,
        tripId: null,
        driverId: d.driverId,
        alertType: "REVENUE_SPIKE",
        severity,
        description: `Driver ${d.driverId}: revenue $${(d.totalRevenue / 100).toFixed(2)} is ${zScore.toFixed(1)} standard deviations above average ($${(mean / 100).toFixed(2)})`,
        details: {
          driverId: d.driverId,
          revenue: d.totalRevenue,
          tripCount: d.tripCount,
          meanRevenue: Math.round(mean),
          stdDev: Math.round(stdDev),
          zScore: Math.round(zScore * 10) / 10,
        },
      });
    }
  }

  return alerts;
}

// ─── Fraud Score for Individual Trip ─────────────────────────────────────────

export async function getFraudScore(tripId: number): Promise<FraudScoreResult> {
  const cacheKey = `${CACHE_PREFIX}:score:${tripId}`;

  try {
    const cached = await getJson<FraudScoreResult>(cacheKey);
    if (cached) return cached;
  } catch {
    const memCached = cache.get<FraudScoreResult>(cacheKey);
    if (memCached) return memCached;
  }

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);

  if (!trip) {
    return { tripId, score: 0, factors: [] };
  }

  const factors: FraudScoreResult["factors"] = [];
  let totalScore = 0;

  // Factor 1: Distance ratio (weight: 30)
  if (trip.distanceMiles && trip.pickupLat && trip.pickupLng && trip.dropoffLat && trip.dropoffLng) {
    const claimed = parseFloat(trip.distanceMiles);
    const straight = haversineKm(trip.pickupLat, trip.pickupLng, trip.dropoffLat, trip.dropoffLng) * 0.621371;
    const ratio = straight > 0.5 ? claimed / straight : 1;
    const flagged = ratio > 3;
    const weight = flagged ? Math.min(30, Math.round((ratio - 1) * 10)) : 0;
    totalScore += weight;
    factors.push({
      name: "Distance ratio",
      weight: 30,
      flagged,
      detail: `Claimed ${claimed.toFixed(1)} mi, straight-line ${straight.toFixed(1)} mi (${ratio.toFixed(1)}x)`,
    });
  }

  // Factor 2: GPS evidence (weight: 25)
  const hasGps = !!(trip.actualDistanceMeters || trip.actualPolyline || trip.startedAt);
  if (!hasGps && trip.status === "COMPLETED") {
    totalScore += 25;
  }
  factors.push({
    name: "GPS evidence",
    weight: 25,
    flagged: !hasGps && trip.status === "COMPLETED",
    detail: hasGps ? "GPS data present" : "No GPS tracking data found",
  });

  // Factor 3: Pickup/Dropoff proximity (weight: 15)
  if (trip.pickupLat && trip.pickupLng && trip.dropoffLat && trip.dropoffLng) {
    const dist = haversineKm(trip.pickupLat, trip.pickupLng, trip.dropoffLat, trip.dropoffLng);
    const tooClose = dist < 0.1 && !trip.isRoundTrip && !trip.pairedTripId;
    if (tooClose) totalScore += 15;
    factors.push({
      name: "Pickup/Dropoff distance",
      weight: 15,
      flagged: tooClose,
      detail: `${Math.round(dist * 1000)}m apart`,
    });
  }

  // Factor 4: Timestamps consistency (weight: 15)
  const hasTimestamps = !!(trip.startedAt && trip.completedAt);
  if (!hasTimestamps && trip.status === "COMPLETED") {
    totalScore += 15;
  }
  factors.push({
    name: "Timestamp completeness",
    weight: 15,
    flagged: !hasTimestamps && trip.status === "COMPLETED",
    detail: hasTimestamps ? "Start/complete timestamps present" : "Missing lifecycle timestamps",
  });

  // Factor 5: Duplicate check (weight: 15)
  if (trip.patientId && trip.scheduledDate && trip.pickupTime) {
    const dupes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(trips)
      .where(
        and(
          eq(trips.patientId, trip.patientId),
          eq(trips.scheduledDate, trip.scheduledDate),
          eq(trips.pickupTime, trip.pickupTime),
          eq(trips.companyId, trip.companyId),
          sql`${trips.id} != ${tripId}`,
          isNull(trips.deletedAt)
        )
      );
    const dupeCount = dupes[0]?.count || 0;
    const flagged = dupeCount > 0;
    if (flagged) totalScore += 15;
    factors.push({
      name: "Duplicate trips",
      weight: 15,
      flagged,
      detail: flagged ? `${dupeCount} duplicate(s) found` : "No duplicates",
    });
  }

  const result: FraudScoreResult = {
    tripId,
    score: Math.min(100, totalScore),
    factors,
  };

  try {
    await setJson(cacheKey, result, CACHE_TTL_SECONDS);
  } catch {
    cache.set(cacheKey, result, CACHE_TTL_SECONDS * 1000);
  }

  return result;
}

// ─── Persist Fraud Alerts to DB ──────────────────────────────────────────────

export async function persistFraudAlerts(alerts: FraudAlert[]): Promise<number> {
  if (alerts.length === 0) return 0;

  let inserted = 0;
  for (const alert of alerts) {
    try {
      await db.insert(fraudAlerts).values({
        companyId: alert.companyId,
        cityId: alert.cityId ?? null,
        tripId: alert.tripId ?? null,
        driverId: alert.driverId ?? null,
        alertType: alert.alertType,
        severity: alert.severity,
        description: alert.description,
        details: alert.details,
        status: "OPEN",
      });
      inserted++;
    } catch (err: any) {
      // Skip duplicates or other insert errors
      console.warn(`[FRAUD] Failed to insert alert: ${err.message}`);
    }
  }

  return inserted;
}

// ─── Background Fraud Monitor ────────────────────────────────────────────────

let fraudMonitorTask: HarnessedTask | null = null;

async function runFraudScan(): Promise<void> {
  console.log("[FRAUD-MONITOR] Starting daily scan...");

  // Get all active companies
  const { companies } = await import("@shared/schema");
  const companyRows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(isNull(companies.deletedAt));

  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 7);

  const dateRange = {
    from: from.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };

  let totalAlerts = 0;

  for (const company of companyRows) {
    try {
      const alerts = await scanForFraud(company.id, dateRange);
      if (alerts.length > 0) {
        const inserted = await persistFraudAlerts(alerts);
        totalAlerts += inserted;
        console.log(`[FRAUD-MONITOR] Company ${company.id}: ${alerts.length} alerts found, ${inserted} new`);
      }
    } catch (err: any) {
      console.error(`[FRAUD-MONITOR] Error scanning company ${company.id}: ${err.message}`);
    }
  }

  console.log(`[FRAUD-MONITOR] Daily scan complete. ${totalAlerts} new alerts inserted.`);
}

const FRAUD_MONITOR_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startFraudMonitor(): void {
  if (fraudMonitorTask) return;

  fraudMonitorTask = createHarnessedTask({
    name: "fraud_monitor",
    lockKey: "scheduler:lock:fraud_monitor",
    lockTtlSeconds: 300,
    timeoutMs: 600_000, // 10 min
    fn: runFraudScan,
  });

  console.log("[FRAUD-MONITOR] Starting (interval: 24h)");
  registerInterval("fraud_monitor", FRAUD_MONITOR_INTERVAL_MS, fraudMonitorTask, 60_000);
}

export function stopFraudMonitor(): void {
  if (fraudMonitorTask) {
    fraudMonitorTask.stop();
    fraudMonitorTask = null;
  }
  console.log("[FRAUD-MONITOR] Stopped");
}
