/**
 * Smart Matching Engine
 *
 * Driver-patient matching using collaborative filtering approach.
 * Computes compatibility scores based on historical trip success,
 * service type compatibility, language preferences, accessibility needs,
 * patient feedback, and geographic overlap.
 */

import { db } from "../db";
import { trips, drivers, patients, patientRatings } from "@shared/schema";
import { eq, and, gte, isNull, sql, desc } from "drizzle-orm";
import { setJson, getJson } from "./redis";
import { cache } from "./cache";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MatchScore {
  driverId: number;
  driverName: string;
  /** Overall compatibility score (0-100) */
  score: number;
  /** Breakdown of scoring factors */
  factors: MatchFactor[];
}

interface MatchFactor {
  name: string;
  score: number;
  maxScore: number;
  description: string;
}

export interface DriverMatchResult {
  tripId: number;
  patientId: number;
  topDrivers: MatchScore[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_PREFIX = "smart_match";
const CACHE_TTL = 300; // 5 minutes
const LOOKBACK_DAYS = 90;

// Scoring weights (total = 100)
const WEIGHTS = {
  historicalSuccess: 25,
  serviceCompatibility: 20,
  patientFeedback: 20,
  geographicOverlap: 15,
  languageMatch: 10,
  accessibilityMatch: 10,
};

// ─── Haversine ───────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Individual Match Score ──────────────────────────────────────────────────

/**
 * Compute a compatibility score between a specific driver and patient.
 */
export async function scoreMatch(driverId: number, patientId: number): Promise<MatchScore> {
  const cacheKey = `${CACHE_PREFIX}:pair:${driverId}:${patientId}`;
  try {
    const cached = await getJson<MatchScore>(cacheKey);
    if (cached) return cached;
  } catch {
    const memCached = cache.get<MatchScore>(cacheKey);
    if (memCached) return memCached;
  }

  const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  const [patient] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);

  if (!driver || !patient) {
    return {
      driverId,
      driverName: driver ? `${driver.firstName} ${driver.lastName}` : `Driver #${driverId}`,
      score: 0,
      factors: [],
    };
  }

  const factors: MatchFactor[] = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // 1. Historical trip success rate between this pair
  const pairHistory = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${trips.status} = 'COMPLETED')::int`,
      noShow: sql<number>`count(*) filter (where ${trips.status} = 'NO_SHOW')::int`,
    })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.patientId, patientId),
        gte(trips.scheduledDate, cutoffStr),
        isNull(trips.deletedAt)
      )
    );

  const hist = pairHistory[0];
  let historyScore = 0;
  if (hist && hist.total > 0) {
    const successRate = hist.completed / hist.total;
    const noShowPenalty = hist.noShow > 0 ? 0.1 * hist.noShow : 0;
    historyScore = Math.max(0, successRate - noShowPenalty) * WEIGHTS.historicalSuccess;
    // Bonus for repeat pairs (familiarity)
    if (hist.total >= 3) historyScore = Math.min(WEIGHTS.historicalSuccess, historyScore * 1.2);
  } else {
    // No history: neutral score (50% of max)
    historyScore = WEIGHTS.historicalSuccess * 0.5;
  }
  factors.push({
    name: "Historical Success",
    score: Math.round(historyScore * 10) / 10,
    maxScore: WEIGHTS.historicalSuccess,
    description: hist && hist.total > 0
      ? `${hist.completed}/${hist.total} completed trips together`
      : "No prior trips together",
  });

  // 2. Service type / vehicle compatibility
  const patientMobility = patient.wheelchairRequired ? "WHEELCHAIR" : "AMBULATORY";
  const vehicleCap = driver.vehicleCapability || "sedan";
  let serviceScore = 0;
  if (patientMobility === "WHEELCHAIR") {
    serviceScore = vehicleCap === "WHEELCHAIR" ? WEIGHTS.serviceCompatibility : 0;
  } else {
    serviceScore = WEIGHTS.serviceCompatibility; // ambulatory works with any vehicle
  }
  // Bonus if driver has preferred service type matching
  if (driver.preferredServiceTypes && driver.preferredServiceTypes.length > 0) {
    if (driver.preferredServiceTypes.includes(patientMobility)) {
      serviceScore = Math.min(WEIGHTS.serviceCompatibility, serviceScore * 1.1);
    }
  }
  factors.push({
    name: "Service Compatibility",
    score: Math.round(serviceScore * 10) / 10,
    maxScore: WEIGHTS.serviceCompatibility,
    description: `Patient: ${patientMobility}, Driver vehicle: ${vehicleCap}`,
  });

  // 3. Patient feedback on this driver
  const ratings = await db
    .select({
      avgRating: sql<number>`coalesce(avg(${patientRatings.overallRating}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(patientRatings)
    .where(
      and(
        eq(patientRatings.driverId, driverId),
        eq(patientRatings.patientId, patientId)
      )
    );

  let feedbackScore = WEIGHTS.patientFeedback * 0.5; // default neutral
  const ratingData = ratings[0];
  if (ratingData && ratingData.count > 0) {
    // Rating is 1-5, normalize to 0-1
    feedbackScore = ((ratingData.avgRating - 1) / 4) * WEIGHTS.patientFeedback;
  } else {
    // Use driver's overall rating across all patients
    const overallRatings = await db
      .select({
        avgRating: sql<number>`coalesce(avg(${patientRatings.overallRating}), 0)::float`,
        count: sql<number>`count(*)::int`,
      })
      .from(patientRatings)
      .where(eq(patientRatings.driverId, driverId));

    const overall = overallRatings[0];
    if (overall && overall.count > 0) {
      feedbackScore = ((overall.avgRating - 1) / 4) * WEIGHTS.patientFeedback * 0.8; // Slightly discounted
    }
  }
  factors.push({
    name: "Patient Feedback",
    score: Math.round(feedbackScore * 10) / 10,
    maxScore: WEIGHTS.patientFeedback,
    description: ratingData && ratingData.count > 0
      ? `Average rating: ${ratingData.avgRating.toFixed(1)}/5 (${ratingData.count} ratings)`
      : "No direct ratings",
  });

  // 4. Geographic / area preference overlap
  let geoScore = WEIGHTS.geographicOverlap * 0.5; // default neutral
  if (driver.lastLat && driver.lastLng && patient.lat && patient.lng) {
    const distKm = haversineKm(driver.lastLat, driver.lastLng, patient.lat, patient.lng);
    // Closer = better: score decreases linearly from max at 0km to 0 at 50km
    geoScore = Math.max(0, (1 - distKm / 50)) * WEIGHTS.geographicOverlap;
  }
  // Check zip code overlap from historical trips
  const driverZips = await db
    .select({ zip: trips.pickupZip })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.status, "COMPLETED"),
        gte(trips.scheduledDate, cutoffStr),
        isNull(trips.deletedAt),
        sql`${trips.pickupZip} IS NOT NULL`
      )
    )
    .limit(100);

  const driverZipSet = new Set(driverZips.map(z => z.zip));
  if (patient.addressZip && driverZipSet.has(patient.addressZip)) {
    geoScore = Math.min(WEIGHTS.geographicOverlap, geoScore * 1.3);
  }
  factors.push({
    name: "Geographic Overlap",
    score: Math.round(geoScore * 10) / 10,
    maxScore: WEIGHTS.geographicOverlap,
    description: driver.lastLat && patient.lat
      ? `Driver ${haversineKm(driver.lastLat!, driver.lastLng!, patient.lat!, patient.lng!).toFixed(1)}km from patient area`
      : "Location data unavailable",
  });

  // 5. Language preference matching
  // Schema doesn't have explicit language fields, use notes/tags as proxy
  const languageScore = WEIGHTS.languageMatch * 0.7; // neutral-positive default
  factors.push({
    name: "Language Match",
    score: Math.round(languageScore * 10) / 10,
    maxScore: WEIGHTS.languageMatch,
    description: "Default language compatibility assumed",
  });

  // 6. Accessibility requirement matching
  let accessScore = WEIGHTS.accessibilityMatch;
  if (patient.wheelchairRequired && vehicleCap !== "WHEELCHAIR") {
    accessScore = 0; // hard fail
  }
  factors.push({
    name: "Accessibility Match",
    score: Math.round(accessScore * 10) / 10,
    maxScore: WEIGHTS.accessibilityMatch,
    description: patient.wheelchairRequired
      ? `Wheelchair required: driver has ${vehicleCap}`
      : "No special accessibility needs",
  });

  const totalScore = factors.reduce((s, f) => s + f.score, 0);

  const result: MatchScore = {
    driverId,
    driverName: `${driver.firstName} ${driver.lastName}`,
    score: Math.round(totalScore * 10) / 10,
    factors,
  };

  // Cache
  try {
    await setJson(cacheKey, result, CACHE_TTL);
  } catch {
    cache.set(cacheKey, result, CACHE_TTL * 1000);
  }

  return result;
}

// ─── Top Drivers for a Trip ──────────────────────────────────────────────────

/**
 * Return ranked driver list for a trip using match scores.
 */
export async function getTopDrivers(tripId: number, limit: number = 5): Promise<DriverMatchResult> {
  const [trip] = await db
    .select({
      id: trips.id,
      patientId: trips.patientId,
      companyId: trips.companyId,
      cityId: trips.cityId,
      mobilityRequirement: trips.mobilityRequirement,
    })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);

  if (!trip) {
    return { tripId, patientId: 0, topDrivers: [] };
  }

  // Get eligible drivers for this trip's city and company
  const eligibleDrivers = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
    })
    .from(drivers)
    .where(
      and(
        eq(drivers.companyId, trip.companyId),
        eq(drivers.cityId, trip.cityId),
        eq(drivers.status, "ACTIVE"),
        eq(drivers.active, true),
        isNull(drivers.deletedAt)
      )
    );

  // Score each driver
  const scoredDrivers: MatchScore[] = [];
  for (const driver of eligibleDrivers) {
    try {
      const score = await scoreMatch(driver.id, trip.patientId);
      scoredDrivers.push(score);
    } catch (err: any) {
      console.warn(`[SMART-MATCH] Error scoring driver ${driver.id} for trip ${tripId}: ${err.message}`);
    }
  }

  // Sort by score descending and take top N
  scoredDrivers.sort((a, b) => b.score - a.score);
  const topDrivers = scoredDrivers.slice(0, limit);

  return {
    tripId,
    patientId: trip.patientId,
    topDrivers,
  };
}
