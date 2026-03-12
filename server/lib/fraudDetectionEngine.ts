/**
 * Fraud Detection Engine
 *
 * Detects suspicious patterns in trips and billing data using two layers:
 *
 * Layer 1 — Heuristic rules:
 *   - Duplicate trips (same patient, time, destination)
 *   - Impossible distances (claimed miles >> actual route)
 *   - Ghost trips (no GPS data during trip)
 *   - Unusual billing patterns (spikes in per-driver revenue)
 *   - Round-trip anomalies (suspiciously identical pickup/dropoff)
 *
 * Layer 2 — Statistical anomaly detection (z-score / isolation-forest-style):
 *   - Driver baselines computed from 60-day history (mean + stddev)
 *   - Company-wide baselines as fallback for new drivers
 *   - Z-score checks: unusually long/short trips, abnormal distance,
 *     out-of-hours operations, excessive daily trips, high dead-mile ratio
 *   - Composite anomaly score (0-1) mapped to additive fraud points
 */

import { db } from "../db";
import { trips, drivers, fraudAlerts, deadMileDailySummary } from "@shared/schema";
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

// ─── Statistical Baseline Types ──────────────────────────────────────────────

interface DriverBaseline {
  driverId: number;
  sampleSize: number;
  avgTripDurationMin: number;
  stdTripDurationMin: number;
  avgMilesPerTrip: number;
  stdMilesPerTrip: number;
  avgTripsPerDay: number;
  avgDeadMileRatio: number;
  stdDeadMileRatio: number;
  /** Hours of day the driver normally operates (0-23), derived from trip start times */
  normalOperatingHours: number[];
  computedAt: string;
}

interface CompanyFraudProfile {
  companyId: number;
  sampleSize: number;
  avgTripDurationMin: number;
  stdTripDurationMin: number;
  avgMilesPerTrip: number;
  stdMilesPerTrip: number;
  avgTripsPerDriverPerDay: number;
  avgDeadMileRatio: number;
  stdDeadMileRatio: number;
  computedAt: string;
}

interface StatisticalAnomaly {
  type: string;
  zScore: number;
  observed: number;
  expected: number;
  stdDev: number;
  description: string;
}

interface StatisticalAnomalyResult {
  tripId: number;
  driverId: number;
  anomalyScore: number; // 0-1
  anomalies: StatisticalAnomaly[];
}

const BASELINE_LOOKBACK_DAYS = 60;
const Z_SCORE_THRESHOLD = 2.0;
const BASELINE_CACHE_TTL = 3600; // 1 hour

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

// ─── Statistical Baseline: Driver ────────────────────────────────────────────

/**
 * Computes statistical baselines from the last 60 days of a driver's completed trips.
 * Uses mean and standard deviation to establish "normal" behavior for comparison.
 */
export async function computeDriverBaseline(driverId: number): Promise<DriverBaseline | null> {
  const cacheKey = `${CACHE_PREFIX}:baseline:driver:${driverId}`;

  try {
    const cached = await getJson<DriverBaseline>(cacheKey);
    if (cached) return cached;
  } catch {
    const memCached = cache.get<DriverBaseline>(cacheKey);
    if (memCached) return memCached;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - BASELINE_LOOKBACK_DAYS);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  // Fetch completed trips for this driver in the lookback window
  const driverTrips = await db
    .select({
      id: trips.id,
      distanceMiles: trips.distanceMiles,
      durationMinutes: trips.durationMinutes,
      actualDurationSeconds: trips.actualDurationSeconds,
      scheduledDate: trips.scheduledDate,
      startedAt: trips.startedAt,
      pickupTime: trips.pickupTime,
    })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.status, "COMPLETED"),
        gte(trips.scheduledDate, cutoff),
        isNull(trips.deletedAt)
      )
    );

  if (driverTrips.length < 5) return null; // not enough data for meaningful stats

  // Compute duration stats (prefer actual, fall back to estimated)
  const durations: number[] = [];
  for (const t of driverTrips) {
    if (t.actualDurationSeconds) {
      durations.push(t.actualDurationSeconds / 60);
    } else if (t.durationMinutes) {
      durations.push(t.durationMinutes);
    }
  }

  // Compute miles stats
  const miles: number[] = [];
  for (const t of driverTrips) {
    if (t.distanceMiles) {
      const m = parseFloat(t.distanceMiles);
      if (m > 0) miles.push(m);
    }
  }

  // Trips per day
  const tripsByDate = new Map<string, number>();
  for (const t of driverTrips) {
    tripsByDate.set(t.scheduledDate, (tripsByDate.get(t.scheduledDate) || 0) + 1);
  }
  const tripsPerDayValues = Array.from(tripsByDate.values());
  const avgTripsPerDay = tripsPerDayValues.length > 0
    ? tripsPerDayValues.reduce((a, b) => a + b, 0) / tripsPerDayValues.length
    : 0;

  // Normal operating hours (derived from pickupTime or startedAt)
  const hourCounts = new Map<number, number>();
  for (const t of driverTrips) {
    let hour: number | null = null;
    if (t.startedAt) {
      hour = new Date(t.startedAt).getHours();
    } else if (t.pickupTime) {
      const match = t.pickupTime.match(/^(\d{1,2}):/);
      if (match) hour = parseInt(match[1], 10);
    }
    if (hour !== null) {
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }
  }
  // Consider "normal" hours as those with at least 5% of trips
  const totalHourEntries = Array.from(hourCounts.values()).reduce((a, b) => a + b, 0);
  const normalHours: number[] = [];
  for (const [h, count] of hourCounts) {
    if (count / totalHourEntries >= 0.05) normalHours.push(h);
  }
  normalHours.sort((a, b) => a - b);

  // Dead mile ratio from daily summaries
  const deadMileData = await db
    .select({
      deadMileRatio: deadMileDailySummary.deadMileRatio,
    })
    .from(deadMileDailySummary)
    .where(
      and(
        eq(deadMileDailySummary.driverId, driverId),
        gte(deadMileDailySummary.summaryDate, cutoff)
      )
    );

  const deadMileRatios = deadMileData.map((d) => parseFloat(d.deadMileRatio));

  const baseline: DriverBaseline = {
    driverId,
    sampleSize: driverTrips.length,
    avgTripDurationMin: mean(durations),
    stdTripDurationMin: stddev(durations),
    avgMilesPerTrip: mean(miles),
    stdMilesPerTrip: stddev(miles),
    avgTripsPerDay,
    avgDeadMileRatio: mean(deadMileRatios),
    stdDeadMileRatio: stddev(deadMileRatios),
    normalOperatingHours: normalHours,
    computedAt: new Date().toISOString(),
  };

  try {
    await setJson(cacheKey, baseline, BASELINE_CACHE_TTL);
  } catch {
    cache.set(cacheKey, baseline, BASELINE_CACHE_TTL * 1000);
  }

  return baseline;
}

// ─── Statistical Baseline: Company ──────────────────────────────────────────

/**
 * Computes company-wide fraud baselines for cross-driver comparison.
 * Useful when a driver has insufficient history for individual baseline.
 */
export async function buildCompanyFraudProfile(companyId: number): Promise<CompanyFraudProfile | null> {
  const cacheKey = `${CACHE_PREFIX}:baseline:company:${companyId}`;

  try {
    const cached = await getJson<CompanyFraudProfile>(cacheKey);
    if (cached) return cached;
  } catch {
    const memCached = cache.get<CompanyFraudProfile>(cacheKey);
    if (memCached) return memCached;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - BASELINE_LOOKBACK_DAYS);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  // Aggregate stats across all completed trips for the company
  const stats = await db
    .select({
      avgDuration: sql<number>`coalesce(avg(coalesce(${trips.actualDurationSeconds} / 60.0, ${trips.durationMinutes})), 0)::float`,
      stdDuration: sql<number>`coalesce(stddev_pop(coalesce(${trips.actualDurationSeconds} / 60.0, ${trips.durationMinutes})), 0)::float`,
      avgMiles: sql<number>`coalesce(avg(${trips.distanceMiles}::float), 0)::float`,
      stdMiles: sql<number>`coalesce(stddev_pop(${trips.distanceMiles}::float), 0)::float`,
      totalTrips: sql<number>`count(*)::int`,
      distinctDays: sql<number>`count(distinct ${trips.scheduledDate})::int`,
      distinctDriverDays: sql<number>`count(distinct (${trips.driverId} || '-' || ${trips.scheduledDate}))::int`,
    })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.status, "COMPLETED"),
        gte(trips.scheduledDate, cutoff),
        sql`${trips.driverId} IS NOT NULL`,
        isNull(trips.deletedAt)
      )
    );

  const s = stats[0];
  if (!s || s.totalTrips < 10) return null;

  const avgTripsPerDriverPerDay = s.distinctDriverDays > 0
    ? s.totalTrips / s.distinctDriverDays
    : 0;

  // Dead mile ratios across the company
  const deadMileData = await db
    .select({
      avgRatio: sql<number>`coalesce(avg(${deadMileDailySummary.deadMileRatio}::float), 0)::float`,
      stdRatio: sql<number>`coalesce(stddev_pop(${deadMileDailySummary.deadMileRatio}::float), 0)::float`,
    })
    .from(deadMileDailySummary)
    .where(
      and(
        eq(deadMileDailySummary.companyId, companyId),
        gte(deadMileDailySummary.summaryDate, cutoff)
      )
    );

  const dm = deadMileData[0];

  const profile: CompanyFraudProfile = {
    companyId,
    sampleSize: s.totalTrips,
    avgTripDurationMin: s.avgDuration,
    stdTripDurationMin: s.stdDuration,
    avgMilesPerTrip: s.avgMiles,
    stdMilesPerTrip: s.stdMiles,
    avgTripsPerDriverPerDay: avgTripsPerDriverPerDay,
    avgDeadMileRatio: dm?.avgRatio || 0,
    stdDeadMileRatio: dm?.stdRatio || 0,
    computedAt: new Date().toISOString(),
  };

  try {
    await setJson(cacheKey, profile, BASELINE_CACHE_TTL);
  } catch {
    cache.set(cacheKey, profile, BASELINE_CACHE_TTL * 1000);
  }

  return profile;
}

// ─── Statistical Anomaly Detection ──────────────────────────────────────────

/**
 * Compares a trip's metrics against the driver's (or company's) baseline using
 * z-score calculations. Flags metrics that are > 2 standard deviations from
 * the mean — a practical approximation of isolation-forest-style anomaly detection.
 *
 * Returns an anomaly score (0-1) and a list of detected anomalies.
 */
export async function detectStatisticalAnomalies(
  tripId: number,
  driverId: number
): Promise<StatisticalAnomalyResult> {
  const result: StatisticalAnomalyResult = {
    tripId,
    driverId,
    anomalyScore: 0,
    anomalies: [],
  };

  // Fetch the trip
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  if (!trip) return result;

  // Get driver baseline, fall back to company baseline
  let baseline = await computeDriverBaseline(driverId);
  let companyProfile: CompanyFraudProfile | null = null;
  let usingCompanyFallback = false;

  if (!baseline) {
    companyProfile = await buildCompanyFraudProfile(trip.companyId);
    if (!companyProfile) return result; // no data at all
    usingCompanyFallback = true;
    // Adapt company profile to baseline shape for uniform z-score checks
    baseline = {
      driverId,
      sampleSize: companyProfile.sampleSize,
      avgTripDurationMin: companyProfile.avgTripDurationMin,
      stdTripDurationMin: companyProfile.stdTripDurationMin,
      avgMilesPerTrip: companyProfile.avgMilesPerTrip,
      stdMilesPerTrip: companyProfile.stdMilesPerTrip,
      avgTripsPerDay: companyProfile.avgTripsPerDriverPerDay,
      avgDeadMileRatio: companyProfile.avgDeadMileRatio,
      stdDeadMileRatio: companyProfile.stdDeadMileRatio,
      normalOperatingHours: [], // can't determine from company aggregate
      computedAt: companyProfile.computedAt,
    };
  }

  const anomalies: StatisticalAnomaly[] = [];

  // --- Check 1: Unusually LONG trip duration ---
  const tripDuration = trip.actualDurationSeconds
    ? trip.actualDurationSeconds / 60
    : trip.durationMinutes || null;

  if (tripDuration !== null && baseline.stdTripDurationMin > 0) {
    const z = (tripDuration - baseline.avgTripDurationMin) / baseline.stdTripDurationMin;
    if (z > Z_SCORE_THRESHOLD) {
      anomalies.push({
        type: "UNUSUALLY_LONG_TRIP",
        zScore: roundTo(z, 2),
        observed: roundTo(tripDuration, 1),
        expected: roundTo(baseline.avgTripDurationMin, 1),
        stdDev: roundTo(baseline.stdTripDurationMin, 1),
        description: `Trip duration ${roundTo(tripDuration, 1)} min is ${roundTo(z, 1)} std devs above driver avg (${roundTo(baseline.avgTripDurationMin, 1)} min)`,
      });
    }

    // --- Check 2: Unusually SHORT trip duration (potential ghost/phantom trip) ---
    if (z < -Z_SCORE_THRESHOLD && tripDuration > 0) {
      anomalies.push({
        type: "UNUSUALLY_SHORT_TRIP",
        zScore: roundTo(Math.abs(z), 2),
        observed: roundTo(tripDuration, 1),
        expected: roundTo(baseline.avgTripDurationMin, 1),
        stdDev: roundTo(baseline.stdTripDurationMin, 1),
        description: `Trip duration ${roundTo(tripDuration, 1)} min is ${roundTo(Math.abs(z), 1)} std devs below driver avg (${roundTo(baseline.avgTripDurationMin, 1)} min)`,
      });
    }
  }

  // --- Check 3: Unusually long/short distance ---
  if (trip.distanceMiles && baseline.stdMilesPerTrip > 0) {
    const miles = parseFloat(trip.distanceMiles);
    if (miles > 0) {
      const z = (miles - baseline.avgMilesPerTrip) / baseline.stdMilesPerTrip;
      if (Math.abs(z) > Z_SCORE_THRESHOLD) {
        const direction = z > 0 ? "above" : "below";
        anomalies.push({
          type: z > 0 ? "UNUSUALLY_LONG_DISTANCE" : "UNUSUALLY_SHORT_DISTANCE",
          zScore: roundTo(Math.abs(z), 2),
          observed: roundTo(miles, 1),
          expected: roundTo(baseline.avgMilesPerTrip, 1),
          stdDev: roundTo(baseline.stdMilesPerTrip, 1),
          description: `Distance ${roundTo(miles, 1)} mi is ${roundTo(Math.abs(z), 1)} std devs ${direction} driver avg (${roundTo(baseline.avgMilesPerTrip, 1)} mi)`,
        });
      }
    }
  }

  // --- Check 4: Trip outside normal operating hours ---
  if (baseline.normalOperatingHours.length > 0) {
    let tripHour: number | null = null;
    if (trip.startedAt) {
      tripHour = new Date(trip.startedAt).getHours();
    } else if (trip.pickupTime) {
      const match = trip.pickupTime.match(/^(\d{1,2}):/);
      if (match) tripHour = parseInt(match[1], 10);
    }

    if (tripHour !== null && !baseline.normalOperatingHours.includes(tripHour)) {
      anomalies.push({
        type: "OUTSIDE_NORMAL_HOURS",
        zScore: Z_SCORE_THRESHOLD, // categorical flag, assign threshold z-score
        observed: tripHour,
        expected: baseline.normalOperatingHours[0], // representative normal hour
        stdDev: 0,
        description: `Trip at hour ${tripHour}:00 is outside driver's normal operating hours (${formatHourRange(baseline.normalOperatingHours)})`,
      });
    }
  }

  // --- Check 5: Too many trips in a day ---
  if (baseline.avgTripsPerDay > 0 && trip.scheduledDate) {
    const dayTripCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(trips)
      .where(
        and(
          eq(trips.driverId, driverId),
          eq(trips.scheduledDate, trip.scheduledDate),
          eq(trips.status, "COMPLETED"),
          isNull(trips.deletedAt)
        )
      );

    const count = dayTripCount[0]?.count || 0;
    // Use a pseudo std dev for trips-per-day (sqrt of avg as approximation if not available)
    const stdTripsPerDay = Math.max(Math.sqrt(baseline.avgTripsPerDay), 1);
    const z = (count - baseline.avgTripsPerDay) / stdTripsPerDay;

    if (z > Z_SCORE_THRESHOLD) {
      anomalies.push({
        type: "EXCESSIVE_DAILY_TRIPS",
        zScore: roundTo(z, 2),
        observed: count,
        expected: roundTo(baseline.avgTripsPerDay, 1),
        stdDev: roundTo(stdTripsPerDay, 1),
        description: `Driver completed ${count} trips on ${trip.scheduledDate}, ${roundTo(z, 1)} std devs above daily avg (${roundTo(baseline.avgTripsPerDay, 1)})`,
      });
    }
  }

  // --- Check 6: Excessive dead miles ---
  if (baseline.stdDeadMileRatio > 0 && trip.scheduledDate) {
    const daySummary = await db
      .select({ deadMileRatio: deadMileDailySummary.deadMileRatio })
      .from(deadMileDailySummary)
      .where(
        and(
          eq(deadMileDailySummary.driverId, driverId),
          eq(deadMileDailySummary.summaryDate, trip.scheduledDate)
        )
      )
      .limit(1);

    if (daySummary.length > 0) {
      const ratio = parseFloat(daySummary[0].deadMileRatio);
      const z = (ratio - baseline.avgDeadMileRatio) / baseline.stdDeadMileRatio;
      if (z > Z_SCORE_THRESHOLD) {
        anomalies.push({
          type: "EXCESSIVE_DEAD_MILES",
          zScore: roundTo(z, 2),
          observed: roundTo(ratio, 4),
          expected: roundTo(baseline.avgDeadMileRatio, 4),
          stdDev: roundTo(baseline.stdDeadMileRatio, 4),
          description: `Dead mile ratio ${roundTo(ratio * 100, 1)}% is ${roundTo(z, 1)} std devs above driver avg (${roundTo(baseline.avgDeadMileRatio * 100, 1)}%)`,
        });
      }
    }
  }

  // Compute composite anomaly score (0-1)
  // Each anomaly contributes proportionally based on its z-score severity
  if (anomalies.length > 0) {
    // Sigmoid-like mapping: sum of individual anomaly weights, capped at 1.0
    // Each anomaly weight = min(0.3, (|z| - threshold) / (threshold * 2))
    // This ensures a single extreme anomaly can contribute up to 0.3, and
    // multiple moderate anomalies compound.
    let totalWeight = 0;
    for (const a of anomalies) {
      const excess = Math.abs(a.zScore) - Z_SCORE_THRESHOLD;
      const weight = Math.min(0.3, excess / (Z_SCORE_THRESHOLD * 2));
      totalWeight += weight;
    }
    result.anomalyScore = Math.min(1.0, roundTo(totalWeight, 4));
    result.anomalies = anomalies;
  }

  return result;
}

// ─── Utility: Math Helpers ───────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function formatHourRange(hours: number[]): string {
  if (hours.length === 0) return "N/A";
  const min = Math.min(...hours);
  const max = Math.max(...hours);
  return `${min}:00-${max}:59`;
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

  // Factor 6: Statistical anomaly detection (weight: up to 25, additive)
  // Uses z-score analysis against driver/company baselines
  if (trip.driverId) {
    try {
      const anomalyResult = await detectStatisticalAnomalies(tripId, trip.driverId);
      if (anomalyResult.anomalyScore > 0) {
        // Convert 0-1 anomaly score to 0-25 point contribution
        const statisticalPoints = Math.round(anomalyResult.anomalyScore * 25);
        totalScore += statisticalPoints;

        const anomalyNames = anomalyResult.anomalies.map((a) => a.type).join(", ");
        const maxZ = Math.max(...anomalyResult.anomalies.map((a) => a.zScore));
        factors.push({
          name: "Statistical anomaly (z-score)",
          weight: 25,
          flagged: true,
          detail: `${anomalyResult.anomalies.length} anomalie(s) detected [${anomalyNames}], max z-score ${maxZ.toFixed(1)}, +${statisticalPoints} pts`,
        });
      } else {
        factors.push({
          name: "Statistical anomaly (z-score)",
          weight: 25,
          flagged: false,
          detail: "Trip metrics within normal range for driver baseline",
        });
      }
    } catch (err: any) {
      // Don't let statistical detection failure break the overall scoring
      console.warn(`[FRAUD] Statistical anomaly detection failed for trip ${tripId}: ${err.message}`);
      factors.push({
        name: "Statistical anomaly (z-score)",
        weight: 25,
        flagged: false,
        detail: "Could not compute (insufficient baseline data)",
      });
    }
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
