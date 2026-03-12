/**
 * ETA Learning Engine
 *
 * Learns from historical trip data to improve ETA predictions.
 * Compares predicted ETA vs actual duration, factors in time of day,
 * day of week, distance, driver speed, and route segments.
 * Stores correction factors per route segment / time bucket.
 */

import { db } from "../db";
import { trips, drivers } from "@shared/schema";
import { eq, and, gte, isNull, sql } from "drizzle-orm";
import { setJson, getJson } from "./redis";
import { cache } from "./cache";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CorrectionFactor {
  /** Multiplicative correction: actual / predicted */
  factor: number;
  /** Number of data points used */
  sampleSize: number;
  /** Confidence in the factor (0-1) */
  confidence: number;
}

interface TimeBucket {
  /** 0=morning(5-9), 1=midday(9-13), 2=afternoon(13-17), 3=evening(17-21), 4=night(21-5) */
  bucket: number;
  label: string;
  factor: CorrectionFactor;
}

interface DayOfWeekFactor {
  /** 0=Sunday, 6=Saturday */
  day: number;
  label: string;
  factor: CorrectionFactor;
}

interface DriverSpeedProfile {
  driverId: number;
  /** Ratio of actual vs estimated duration across trips */
  speedFactor: number;
  sampleSize: number;
}

interface ETAModel {
  companyId: number;
  /** Overall correction factor */
  globalFactor: CorrectionFactor;
  /** Time-of-day correction factors */
  timeBuckets: TimeBucket[];
  /** Day-of-week correction factors */
  dayOfWeekFactors: DayOfWeekFactor[];
  /** Distance-band corrections (short/medium/long) */
  distanceBands: Array<{
    label: string;
    minMiles: number;
    maxMiles: number;
    factor: CorrectionFactor;
  }>;
  /** Per-driver speed profiles */
  driverProfiles: Map<number, DriverSpeedProfile>;
  trainedAt: string;
  totalSamples: number;
}

export interface ETAPrediction {
  tripId: number;
  /** Adjusted ETA in minutes */
  expectedMinutes: number;
  /** Low-end estimate (optimistic) */
  lowMinutes: number;
  /** High-end estimate (pessimistic) */
  highMinutes: number;
  /** Confidence in prediction (0-1) */
  confidence: number;
  /** What corrections were applied */
  corrections: Array<{ type: string; factor: number; description: string }>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL_CACHE_KEY_PREFIX = "eta_model";
const MODEL_CACHE_TTL = 3600; // 1 hour
const LOOKBACK_DAYS = 90;

const TIME_BUCKET_LABELS = ["early_morning", "midday", "afternoon", "evening", "night"];
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getTimeBucket(hour: number): number {
  if (hour >= 5 && hour < 9) return 0;
  if (hour >= 9 && hour < 13) return 1;
  if (hour >= 13 && hour < 17) return 2;
  if (hour >= 17 && hour < 21) return 3;
  return 4;
}

function makeCorrectionFactor(values: number[]): CorrectionFactor {
  if (values.length === 0) return { factor: 1.0, sampleSize: 0, confidence: 0 };

  const sorted = [...values].sort((a, b) => a - b);
  // Use median for robustness against outliers
  const median = sorted[Math.floor(sorted.length / 2)];
  // Confidence increases with sample size (asymptotic to 1)
  const confidence = Math.min(1, values.length / 50);

  return {
    factor: Math.round(median * 1000) / 1000,
    sampleSize: values.length,
    confidence: Math.round(confidence * 100) / 100,
  };
}

// ─── Model Training ──────────────────────────────────────────────────────────

/**
 * Analyze completed trips to build an ETA accuracy model for a company.
 * Compares predicted ETA (durationMinutes / routeDurationSeconds) to actual duration.
 */
export async function trainETAModel(companyId: number): Promise<ETAModel> {
  const cacheKey = `${MODEL_CACHE_KEY_PREFIX}:${companyId}`;

  // Check cache
  try {
    const cached = await getJson<ETAModel & { driverProfiles: Array<[number, DriverSpeedProfile]> }>(cacheKey);
    if (cached) {
      return {
        ...cached,
        driverProfiles: new Map(cached.driverProfiles),
      };
    }
  } catch {
    const memCached = cache.get<ETAModel>(cacheKey);
    if (memCached) return memCached;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  // Fetch completed trips with both predicted and actual duration
  const completedTrips = await db
    .select({
      id: trips.id,
      driverId: trips.driverId,
      scheduledDate: trips.scheduledDate,
      pickupTime: trips.pickupTime,
      durationMinutes: trips.durationMinutes,
      routeDurationSeconds: trips.routeDurationSeconds,
      actualDurationSeconds: trips.actualDurationSeconds,
      distanceMiles: trips.distanceMiles,
      startedAt: trips.startedAt,
      completedAt: trips.completedAt,
    })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.status, "COMPLETED"),
        gte(trips.scheduledDate, cutoff),
        isNull(trips.deletedAt),
        sql`${trips.startedAt} IS NOT NULL`,
        sql`${trips.completedAt} IS NOT NULL`
      )
    );

  // Compute correction ratios: actual / predicted
  const globalRatios: number[] = [];
  const timeBucketRatios: number[][] = [[], [], [], [], []];
  const dayRatios: number[][] = [[], [], [], [], [], [], []];
  const distanceBandRatios: { short: number[]; medium: number[]; long: number[] } = {
    short: [], medium: [], long: [],
  };
  const driverRatios = new Map<number, number[]>();

  for (const trip of completedTrips) {
    // Compute actual duration in minutes
    let actualMinutes: number | null = null;
    if (trip.actualDurationSeconds) {
      actualMinutes = trip.actualDurationSeconds / 60;
    } else if (trip.startedAt && trip.completedAt) {
      actualMinutes = (new Date(trip.completedAt).getTime() - new Date(trip.startedAt).getTime()) / 60000;
    }
    if (!actualMinutes || actualMinutes <= 0) continue;

    // Compute predicted duration in minutes
    let predictedMinutes: number | null = null;
    if (trip.routeDurationSeconds) {
      predictedMinutes = trip.routeDurationSeconds / 60;
    } else if (trip.durationMinutes) {
      predictedMinutes = trip.durationMinutes;
    }
    if (!predictedMinutes || predictedMinutes <= 0) continue;

    const ratio = actualMinutes / predictedMinutes;
    // Filter extreme outliers (ratio < 0.2 or > 5.0)
    if (ratio < 0.2 || ratio > 5.0) continue;

    globalRatios.push(ratio);

    // Time bucket
    let hour: number | null = null;
    if (trip.startedAt) {
      hour = new Date(trip.startedAt).getHours();
    } else if (trip.pickupTime) {
      const match = trip.pickupTime.match(/^(\d{1,2}):/);
      if (match) hour = parseInt(match[1], 10);
    }
    if (hour !== null) {
      timeBucketRatios[getTimeBucket(hour)].push(ratio);
    }

    // Day of week
    if (trip.scheduledDate) {
      const dayOfWeek = new Date(trip.scheduledDate + "T12:00:00Z").getDay();
      dayRatios[dayOfWeek].push(ratio);
    }

    // Distance band
    if (trip.distanceMiles) {
      const miles = parseFloat(trip.distanceMiles);
      if (miles <= 5) distanceBandRatios.short.push(ratio);
      else if (miles <= 20) distanceBandRatios.medium.push(ratio);
      else distanceBandRatios.long.push(ratio);
    }

    // Driver profile
    if (trip.driverId) {
      if (!driverRatios.has(trip.driverId)) driverRatios.set(trip.driverId, []);
      driverRatios.get(trip.driverId)!.push(ratio);
    }
  }

  // Build model
  const driverProfiles = new Map<number, DriverSpeedProfile>();
  for (const [driverId, ratios] of driverRatios) {
    if (ratios.length >= 3) {
      const median = [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
      driverProfiles.set(driverId, {
        driverId,
        speedFactor: Math.round(median * 1000) / 1000,
        sampleSize: ratios.length,
      });
    }
  }

  const model: ETAModel = {
    companyId,
    globalFactor: makeCorrectionFactor(globalRatios),
    timeBuckets: TIME_BUCKET_LABELS.map((label, i) => ({
      bucket: i,
      label,
      factor: makeCorrectionFactor(timeBucketRatios[i]),
    })),
    dayOfWeekFactors: DAY_LABELS.map((label, i) => ({
      day: i,
      label,
      factor: makeCorrectionFactor(dayRatios[i]),
    })),
    distanceBands: [
      { label: "short", minMiles: 0, maxMiles: 5, factor: makeCorrectionFactor(distanceBandRatios.short) },
      { label: "medium", minMiles: 5, maxMiles: 20, factor: makeCorrectionFactor(distanceBandRatios.medium) },
      { label: "long", minMiles: 20, maxMiles: Infinity, factor: makeCorrectionFactor(distanceBandRatios.long) },
    ],
    driverProfiles,
    trainedAt: new Date().toISOString(),
    totalSamples: globalRatios.length,
  };

  // Cache the model (serialize Map for Redis)
  const serializable = {
    ...model,
    driverProfiles: Array.from(model.driverProfiles.entries()),
  };
  try {
    await setJson(cacheKey, serializable, MODEL_CACHE_TTL);
  } catch {
    cache.set(cacheKey, model, MODEL_CACHE_TTL * 1000);
  }

  return model;
}

// ─── ETA Prediction ──────────────────────────────────────────────────────────

/**
 * Return an adjusted ETA prediction for a trip using learned correction factors.
 */
export async function predictETA(tripId: number): Promise<ETAPrediction> {
  const [trip] = await db
    .select({
      id: trips.id,
      companyId: trips.companyId,
      driverId: trips.driverId,
      scheduledDate: trips.scheduledDate,
      pickupTime: trips.pickupTime,
      durationMinutes: trips.durationMinutes,
      routeDurationSeconds: trips.routeDurationSeconds,
      distanceMiles: trips.distanceMiles,
      lastEtaMinutes: trips.lastEtaMinutes,
    })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);

  if (!trip) {
    return {
      tripId,
      expectedMinutes: 0,
      lowMinutes: 0,
      highMinutes: 0,
      confidence: 0,
      corrections: [],
    };
  }

  // Get base ETA (from real-time ETA, route duration, or estimated duration)
  let baseMinutes = trip.lastEtaMinutes
    || (trip.routeDurationSeconds ? trip.routeDurationSeconds / 60 : null)
    || trip.durationMinutes
    || 30; // fallback

  // Load model
  let model: ETAModel;
  try {
    model = await trainETAModel(trip.companyId);
  } catch {
    return {
      tripId,
      expectedMinutes: Math.round(baseMinutes),
      lowMinutes: Math.round(baseMinutes * 0.8),
      highMinutes: Math.round(baseMinutes * 1.3),
      confidence: 0.3,
      corrections: [{ type: "fallback", factor: 1.0, description: "No model available, using raw estimate" }],
    };
  }

  if (model.totalSamples < 10) {
    return {
      tripId,
      expectedMinutes: Math.round(baseMinutes),
      lowMinutes: Math.round(baseMinutes * 0.8),
      highMinutes: Math.round(baseMinutes * 1.3),
      confidence: 0.3,
      corrections: [{ type: "insufficient_data", factor: 1.0, description: `Only ${model.totalSamples} training samples` }],
    };
  }

  const corrections: ETAPrediction["corrections"] = [];
  let combinedFactor = 1.0;
  let confidenceSum = 0;
  let factorCount = 0;

  // 1. Global correction
  if (model.globalFactor.confidence > 0.1) {
    combinedFactor *= model.globalFactor.factor;
    corrections.push({
      type: "global",
      factor: model.globalFactor.factor,
      description: `Global correction from ${model.globalFactor.sampleSize} trips`,
    });
    confidenceSum += model.globalFactor.confidence;
    factorCount++;
  }

  // 2. Time-of-day correction
  let hour: number | null = null;
  if (trip.pickupTime) {
    const match = trip.pickupTime.match(/^(\d{1,2}):/);
    if (match) hour = parseInt(match[1], 10);
  }
  if (hour !== null) {
    const bucket = getTimeBucket(hour);
    const timeFactor = model.timeBuckets[bucket]?.factor;
    if (timeFactor && timeFactor.confidence > 0.1 && timeFactor.sampleSize >= 5) {
      // Apply relative to global: timeFactor.factor / globalFactor
      const relativeFactor = model.globalFactor.factor > 0
        ? timeFactor.factor / model.globalFactor.factor
        : timeFactor.factor;
      combinedFactor *= relativeFactor;
      corrections.push({
        type: "time_of_day",
        factor: relativeFactor,
        description: `${model.timeBuckets[bucket].label} adjustment (${timeFactor.sampleSize} samples)`,
      });
      confidenceSum += timeFactor.confidence;
      factorCount++;
    }
  }

  // 3. Day-of-week correction
  if (trip.scheduledDate) {
    const dayOfWeek = new Date(trip.scheduledDate + "T12:00:00Z").getDay();
    const dayFactor = model.dayOfWeekFactors[dayOfWeek]?.factor;
    if (dayFactor && dayFactor.confidence > 0.1 && dayFactor.sampleSize >= 5) {
      const relativeFactor = model.globalFactor.factor > 0
        ? dayFactor.factor / model.globalFactor.factor
        : dayFactor.factor;
      combinedFactor *= relativeFactor;
      corrections.push({
        type: "day_of_week",
        factor: relativeFactor,
        description: `${model.dayOfWeekFactors[dayOfWeek].label} adjustment`,
      });
      confidenceSum += dayFactor.confidence;
      factorCount++;
    }
  }

  // 4. Distance-band correction
  if (trip.distanceMiles) {
    const miles = parseFloat(trip.distanceMiles);
    const band = model.distanceBands.find(b => miles >= b.minMiles && miles < b.maxMiles);
    if (band && band.factor.confidence > 0.1 && band.factor.sampleSize >= 5) {
      const relativeFactor = model.globalFactor.factor > 0
        ? band.factor.factor / model.globalFactor.factor
        : band.factor.factor;
      combinedFactor *= relativeFactor;
      corrections.push({
        type: "distance_band",
        factor: relativeFactor,
        description: `${band.label} distance (${miles.toFixed(1)} mi) adjustment`,
      });
      confidenceSum += band.factor.confidence;
      factorCount++;
    }
  }

  // 5. Driver-specific speed factor
  if (trip.driverId && model.driverProfiles.has(trip.driverId)) {
    const profile = model.driverProfiles.get(trip.driverId)!;
    if (profile.sampleSize >= 5) {
      const relativeFactor = model.globalFactor.factor > 0
        ? profile.speedFactor / model.globalFactor.factor
        : profile.speedFactor;
      combinedFactor *= relativeFactor;
      corrections.push({
        type: "driver_speed",
        factor: relativeFactor,
        description: `Driver speed profile (${profile.sampleSize} trips)`,
      });
      confidenceSum += Math.min(1, profile.sampleSize / 30);
      factorCount++;
    }
  }

  // 6. Weather/traffic multiplier placeholder
  // In production, integrate with a weather API and traffic data
  corrections.push({
    type: "weather_traffic",
    factor: 1.0,
    description: "Weather/traffic placeholder (no adjustment)",
  });

  // Compute adjusted ETA
  const adjustedMinutes = baseMinutes * combinedFactor;
  const overallConfidence = factorCount > 0
    ? Math.min(1, confidenceSum / factorCount)
    : 0.3;

  // Confidence interval: widen with lower confidence
  const uncertaintyRange = 1 - overallConfidence * 0.5; // 0.5 to 1.0
  const lowMinutes = adjustedMinutes * (1 - uncertaintyRange * 0.3);
  const highMinutes = adjustedMinutes * (1 + uncertaintyRange * 0.4);

  return {
    tripId,
    expectedMinutes: Math.round(adjustedMinutes),
    lowMinutes: Math.round(lowMinutes),
    highMinutes: Math.round(highMinutes),
    confidence: Math.round(overallConfidence * 100) / 100,
    corrections,
  };
}
