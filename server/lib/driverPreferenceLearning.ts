/**
 * Driver Preference Learning Engine
 *
 * Analyzes completed trip history to learn driver preferences and produce
 * a 0-1 match score that the auto-assign engine uses as a bonus signal.
 *
 * Preferences tracked:
 *   - Time-of-day slots (morning / afternoon / evening)
 *   - Geographic zones (pickup zip codes)
 *   - Mobility-requirement affinity
 *   - Average trip distance
 *   - Patient satisfaction (from patientRatings)
 */

import { db } from "../db";
import { trips, drivers, companies, patientRatings } from "@shared/schema";
import { eq, and, gte, isNull, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimeSlotDistribution {
  morning: number;   // 5:00-11:59
  afternoon: number; // 12:00-16:59
  evening: number;   // 17:00-23:59
}

interface DriverPreferences {
  driverId: number;
  companyId: number;
  /** Normalised distribution (sums to 1) across time slots */
  timeSlots: TimeSlotDistribution;
  /** Map of pickup zip -> fraction of total trips */
  areaZips: Map<string, number>;
  /** Map of mobilityRequirement -> fraction of total trips */
  mobilityTypes: Map<string, number>;
  /** Average trip distance in meters (null if unknown) */
  avgDistanceMeters: number | null;
  /** Average overall patient rating 1-5 (null if no ratings) */
  avgPatientRating: number | null;
  /** Number of completed trips in the analysis window */
  sampleSize: number;
  /** When this was computed */
  computedAt: Date;
}

// ---------------------------------------------------------------------------
// In-memory cache with TTL
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 25 * 60 * 60 * 1000; // 25 hours — survives between daily refreshes

interface CacheEntry {
  prefs: DriverPreferences;
  expiresAt: number;
}

const prefsCache = new Map<number, CacheEntry>();

function getCached(driverId: number): DriverPreferences | null {
  const entry = prefsCache.get(driverId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    prefsCache.delete(driverId);
    return null;
  }
  return entry.prefs;
}

function setCache(driverId: number, prefs: DriverPreferences): void {
  prefsCache.set(driverId, {
    prefs,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ---------------------------------------------------------------------------
// Time-slot helpers
// ---------------------------------------------------------------------------

function pickupTimeToSlot(pickupTime: string): keyof TimeSlotDistribution {
  // pickupTime is stored as "HH:MM" or "HH:MM:SS" or similar text
  const hour = parseInt(pickupTime.split(":")[0], 10);
  if (isNaN(hour)) return "morning";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

const ANALYSIS_DAYS = 90;

export async function computeDriverPreferences(driverId: number): Promise<DriverPreferences> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ANALYSIS_DAYS);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  // Fetch completed trips for this driver in the last 90 days
  const completedTrips = await db
    .select({
      id: trips.id,
      pickupTime: trips.pickupTime,
      pickupZip: trips.pickupZip,
      pickupLat: trips.pickupLat,
      pickupLng: trips.pickupLng,
      dropoffLat: trips.dropoffLat,
      dropoffLng: trips.dropoffLng,
      mobilityRequirement: trips.mobilityRequirement,
      routeDistanceMeters: trips.routeDistanceMeters,
      actualDistanceMeters: trips.actualDistanceMeters,
      companyId: trips.companyId,
    })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.status, "COMPLETED"),
        gte(trips.scheduledDate, cutoffStr),
        isNull(trips.deletedAt)
      )
    );

  const companyId = completedTrips.length > 0 ? completedTrips[0].companyId : 0;

  // Time-slot distribution
  const slotCounts: TimeSlotDistribution = { morning: 0, afternoon: 0, evening: 0 };
  // Zip distribution
  const zipCounts = new Map<string, number>();
  // Mobility distribution
  const mobilityCounts = new Map<string, number>();
  // Distance accumulator
  let distanceSum = 0;
  let distanceCount = 0;

  for (const t of completedTrips) {
    // Time slots
    if (t.pickupTime) {
      const slot = pickupTimeToSlot(t.pickupTime);
      slotCounts[slot]++;
    }

    // Zip codes
    if (t.pickupZip) {
      zipCounts.set(t.pickupZip, (zipCounts.get(t.pickupZip) || 0) + 1);
    }

    // Mobility
    const mob = t.mobilityRequirement || "STANDARD";
    mobilityCounts.set(mob, (mobilityCounts.get(mob) || 0) + 1);

    // Distance
    const dist = t.actualDistanceMeters ?? t.routeDistanceMeters;
    if (dist != null && dist > 0) {
      distanceSum += dist;
      distanceCount++;
    }
  }

  const total = completedTrips.length || 1; // avoid division by zero

  // Normalise time slots
  const timeSlots: TimeSlotDistribution = {
    morning: slotCounts.morning / total,
    afternoon: slotCounts.afternoon / total,
    evening: slotCounts.evening / total,
  };

  // Normalise zips
  const areaZips = new Map<string, number>();
  for (const [zip, count] of zipCounts) {
    areaZips.set(zip, count / total);
  }

  // Normalise mobility
  const mobilityTypes = new Map<string, number>();
  for (const [mob, count] of mobilityCounts) {
    mobilityTypes.set(mob, count / total);
  }

  // Average distance
  const avgDistanceMeters = distanceCount > 0 ? distanceSum / distanceCount : null;

  // Patient satisfaction
  let avgPatientRating: number | null = null;
  try {
    const ratingRows = await db
      .select({
        avgRating: sql<number>`avg(${patientRatings.overallRating})`,
      })
      .from(patientRatings)
      .where(eq(patientRatings.driverId, driverId));

    if (ratingRows.length > 0 && ratingRows[0].avgRating != null) {
      avgPatientRating = Math.round(Number(ratingRows[0].avgRating) * 100) / 100;
    }
  } catch {
    // patientRatings table may not exist yet; ignore
  }

  const prefs: DriverPreferences = {
    driverId,
    companyId,
    timeSlots,
    areaZips,
    mobilityTypes,
    avgDistanceMeters,
    avgPatientRating,
    sampleSize: completedTrips.length,
    computedAt: new Date(),
  };

  setCache(driverId, prefs);
  return prefs;
}

// ---------------------------------------------------------------------------
// Scoring a trip against learned preferences  (0 – 1)
// ---------------------------------------------------------------------------

export async function getPreferenceScore(
  driverId: number,
  trip: {
    pickupTime: string;
    pickupLat: number;
    pickupLng: number;
    pickupZip?: string | null;
    mobilityRequirement: string;
    routeDistanceMeters?: number | null;
  }
): Promise<number> {
  let prefs = getCached(driverId);
  if (!prefs) {
    prefs = await computeDriverPreferences(driverId);
  }

  // If driver has no meaningful history, return neutral 0.5
  if (prefs.sampleSize < 5) return 0.5;

  // 1. Time-slot match (weight 0.30)
  const slot = pickupTimeToSlot(trip.pickupTime);
  const timeScore = prefs.timeSlots[slot]; // already 0-1

  // 2. Area match (weight 0.25)
  let areaScore = 0;
  if (trip.pickupZip && prefs.areaZips.has(trip.pickupZip)) {
    // Scale: if 50%+ of trips in this zip, full score; linear below
    areaScore = Math.min(1, prefs.areaZips.get(trip.pickupZip)! * 2);
  }

  // 3. Mobility type match (weight 0.25)
  const mob = trip.mobilityRequirement || "STANDARD";
  const mobilityScore = prefs.mobilityTypes.has(mob)
    ? Math.min(1, prefs.mobilityTypes.get(mob)! * 2) // scale similarly
    : 0;

  // 4. Distance preference match (weight 0.10)
  let distanceMatchScore = 0.5; // neutral default
  if (prefs.avgDistanceMeters != null && trip.routeDistanceMeters != null && trip.routeDistanceMeters > 0) {
    const ratio = trip.routeDistanceMeters / prefs.avgDistanceMeters;
    // Closer to 1.0 ratio = better match; penalise large deviations
    distanceMatchScore = Math.max(0, 1 - Math.abs(ratio - 1));
  }

  // 5. Patient satisfaction bonus (weight 0.10)
  // Drivers with higher ratings get a slight boost
  let satisfactionScore = 0.5; // neutral
  if (prefs.avgPatientRating != null) {
    satisfactionScore = Math.min(1, Math.max(0, (prefs.avgPatientRating - 1) / 4)); // maps 1-5 to 0-1
  }

  const score =
    0.30 * timeScore +
    0.25 * areaScore +
    0.25 * mobilityScore +
    0.10 * distanceMatchScore +
    0.10 * satisfactionScore;

  return Math.round(score * 1000) / 1000; // 3 decimal places
}

// ---------------------------------------------------------------------------
// Batch refresh for a company
// ---------------------------------------------------------------------------

export async function refreshAllDriverPreferences(companyId: number): Promise<{ refreshed: number }> {
  const companyDrivers = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(
      and(
        eq(drivers.companyId, companyId),
        eq(drivers.active, true),
        isNull(drivers.deletedAt)
      )
    );

  let refreshed = 0;
  for (const driver of companyDrivers) {
    await computeDriverPreferences(driver.id);
    refreshed++;
  }

  return { refreshed };
}

// ---------------------------------------------------------------------------
// Daily scheduler — runs at 2 AM
// ---------------------------------------------------------------------------

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export function startDriverPreferenceLearningScheduler(): void {
  if (schedulerTimer) return;

  // Run once on startup (deferred to avoid blocking boot)
  setTimeout(() => runDailyRefresh(), 30_000);

  // Then schedule to run at 2 AM daily
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function msUntilNext2AM(): number {
    const now = new Date();
    const next2AM = new Date(now);
    next2AM.setHours(2, 0, 0, 0);
    if (next2AM.getTime() <= now.getTime()) {
      next2AM.setDate(next2AM.getDate() + 1);
    }
    return next2AM.getTime() - now.getTime();
  }

  // Set an initial timeout to the next 2 AM, then repeat every 24h
  const initialDelay = msUntilNext2AM();
  setTimeout(() => {
    runDailyRefresh();
    schedulerTimer = setInterval(() => runDailyRefresh(), MS_PER_DAY);
  }, initialDelay);

  console.log(
    JSON.stringify({
      event: "driver_preference_learning_scheduler_started",
      nextRunIn: `${Math.round(initialDelay / 60000)}min`,
      ts: new Date().toISOString(),
    })
  );
}

async function runDailyRefresh(): Promise<void> {
  try {
    const allCompanies = await db
      .select({ id: companies.id })
      .from(companies);

    let totalRefreshed = 0;
    for (const company of allCompanies) {
      const result = await refreshAllDriverPreferences(company.id);
      totalRefreshed += result.refreshed;
    }

    console.log(
      JSON.stringify({
        event: "driver_preference_learning_refresh_complete",
        companiesProcessed: allCompanies.length,
        driversRefreshed: totalRefreshed,
        ts: new Date().toISOString(),
      })
    );
  } catch (err: any) {
    console.error(
      JSON.stringify({
        event: "driver_preference_learning_refresh_error",
        error: err.message,
        ts: new Date().toISOString(),
      })
    );
  }
}
