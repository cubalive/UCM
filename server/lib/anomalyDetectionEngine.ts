/**
 * Anomaly Detection Engine
 *
 * ML-style multi-dimensional anomaly detection for trips using
 * an isolation-forest-inspired approach. Extracts features from trips
 * and compares against company baselines using distance-from-centroid scoring.
 */

import { db } from "../db";
import { trips, drivers } from "@shared/schema";
import { eq, and, gte, isNull, sql } from "drizzle-orm";
import { setJson, getJson } from "./redis";
import { cache } from "./cache";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FeatureVector {
  duration: number;      // trip duration in minutes
  distance: number;      // trip distance in miles
  cost: number;          // trip cost in cents
  hourOfDay: number;     // 0-23
  dayOfWeek: number;     // 0-6
  serviceTypeIdx: number; // encoded service type
}

interface FeatureStats {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

interface AnomalyModel {
  companyId: number;
  features: {
    duration: FeatureStats;
    distance: FeatureStats;
    cost: FeatureStats;
    hourOfDay: FeatureStats;
    dayOfWeek: FeatureStats;
    serviceTypeIdx: FeatureStats;
  };
  sampleSize: number;
  /** Outlier thresholds per dimension (z-score threshold) */
  thresholds: {
    duration: number;
    distance: number;
    cost: number;
    hourOfDay: number;
    dayOfWeek: number;
    serviceTypeIdx: number;
  };
  trainedAt: string;
}

interface AnomalyDimension {
  dimension: string;
  observed: number;
  expected: number;
  zScore: number;
  isAnomaly: boolean;
  description: string;
}

export interface AnomalyResult {
  tripId: number;
  /** Overall anomaly score 0-1 (higher = more anomalous) */
  anomalyScore: number;
  /** Per-dimension anomaly breakdown */
  dimensions: AnomalyDimension[];
  /** Human-readable anomaly summary */
  summary: string;
  /** Model metadata */
  modelInfo: {
    companyId: number;
    sampleSize: number;
    trainedAt: string;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL_CACHE_PREFIX = "anomaly_model";
const MODEL_CACHE_TTL = 3600; // 1 hour
const LOOKBACK_DAYS = 90;
const DEFAULT_Z_THRESHOLD = 2.5;

const SERVICE_TYPE_MAP: Record<string, number> = {
  AMBULATORY: 0, STANDARD: 0,
  WHEELCHAIR: 1,
  STRETCHER: 2,
  BARIATRIC: 3,
};

// ─── Math Helpers ────────────────────────────────────────────────────────────

function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeStddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = computeMean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeStats(values: number[]): FeatureStats {
  if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 };
  return {
    mean: computeMean(values),
    stddev: computeStddev(values),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

// ─── Model Building ──────────────────────────────────────────────────────────

/**
 * Build feature distributions from historical trips for a company.
 * Computes multivariate statistics and identifies outlier thresholds.
 */
export async function buildAnomalyModel(companyId: number): Promise<AnomalyModel> {
  const cacheKey = `${MODEL_CACHE_PREFIX}:${companyId}`;

  // Check cache
  try {
    const cached = await getJson<AnomalyModel>(cacheKey);
    if (cached) return cached;
  } catch {
    const memCached = cache.get<AnomalyModel>(cacheKey);
    if (memCached) return memCached;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const completedTrips = await db
    .select({
      durationMinutes: trips.durationMinutes,
      actualDurationSeconds: trips.actualDurationSeconds,
      distanceMiles: trips.distanceMiles,
      priceTotalCents: trips.priceTotalCents,
      pickupTime: trips.pickupTime,
      scheduledDate: trips.scheduledDate,
      mobilityRequirement: trips.mobilityRequirement,
      startedAt: trips.startedAt,
    })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.status, "COMPLETED"),
        gte(trips.scheduledDate, cutoffStr),
        isNull(trips.deletedAt)
      )
    );

  const durations: number[] = [];
  const distances: number[] = [];
  const costs: number[] = [];
  const hours: number[] = [];
  const days: number[] = [];
  const serviceTypes: number[] = [];

  for (const t of completedTrips) {
    // Duration
    let dur: number | null = null;
    if (t.actualDurationSeconds) dur = t.actualDurationSeconds / 60;
    else if (t.durationMinutes) dur = t.durationMinutes;
    if (dur && dur > 0) durations.push(dur);

    // Distance
    if (t.distanceMiles) {
      const d = parseFloat(t.distanceMiles);
      if (d > 0) distances.push(d);
    }

    // Cost
    if (t.priceTotalCents && t.priceTotalCents > 0) costs.push(t.priceTotalCents);

    // Hour
    let hour: number | null = null;
    if (t.startedAt) {
      hour = new Date(t.startedAt).getHours();
    } else if (t.pickupTime) {
      const match = t.pickupTime.match(/^(\d{1,2}):/);
      if (match) hour = parseInt(match[1], 10);
    }
    if (hour !== null) hours.push(hour);

    // Day of week
    if (t.scheduledDate) {
      days.push(new Date(t.scheduledDate + "T12:00:00Z").getDay());
    }

    // Service type
    serviceTypes.push(SERVICE_TYPE_MAP[t.mobilityRequirement] ?? 0);
  }

  const model: AnomalyModel = {
    companyId,
    features: {
      duration: computeStats(durations),
      distance: computeStats(distances),
      cost: computeStats(costs),
      hourOfDay: computeStats(hours),
      dayOfWeek: computeStats(days),
      serviceTypeIdx: computeStats(serviceTypes),
    },
    sampleSize: completedTrips.length,
    thresholds: {
      duration: DEFAULT_Z_THRESHOLD,
      distance: DEFAULT_Z_THRESHOLD,
      cost: DEFAULT_Z_THRESHOLD,
      hourOfDay: 3.0, // hours are cyclical, be more lenient
      dayOfWeek: 3.5,
      serviceTypeIdx: 3.5,
    },
    trainedAt: new Date().toISOString(),
  };

  // Cache
  try {
    await setJson(cacheKey, model, MODEL_CACHE_TTL);
  } catch {
    cache.set(cacheKey, model, MODEL_CACHE_TTL * 1000);
  }

  return model;
}

// ─── Anomaly Detection ───────────────────────────────────────────────────────

/**
 * Multi-dimensional anomaly scoring for a single trip.
 * Uses distance from cluster centroid (isolation-forest-inspired approach).
 */
export async function detectTripAnomalies(tripId: number): Promise<AnomalyResult> {
  const [trip] = await db
    .select({
      id: trips.id,
      companyId: trips.companyId,
      durationMinutes: trips.durationMinutes,
      actualDurationSeconds: trips.actualDurationSeconds,
      distanceMiles: trips.distanceMiles,
      priceTotalCents: trips.priceTotalCents,
      pickupTime: trips.pickupTime,
      scheduledDate: trips.scheduledDate,
      mobilityRequirement: trips.mobilityRequirement,
      startedAt: trips.startedAt,
    })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);

  if (!trip) {
    return {
      tripId,
      anomalyScore: 0,
      dimensions: [],
      summary: "Trip not found",
      modelInfo: { companyId: 0, sampleSize: 0, trainedAt: "" },
    };
  }

  const model = await buildAnomalyModel(trip.companyId);

  if (model.sampleSize < 20) {
    return {
      tripId,
      anomalyScore: 0,
      dimensions: [],
      summary: "Insufficient historical data for anomaly detection",
      modelInfo: { companyId: model.companyId, sampleSize: model.sampleSize, trainedAt: model.trainedAt },
    };
  }

  const dimensions: AnomalyDimension[] = [];
  const zScores: number[] = [];

  // Helper to check a dimension
  function checkDimension(
    name: string,
    observed: number | null,
    stats: FeatureStats,
    threshold: number,
    label: string
  ) {
    if (observed === null || stats.stddev === 0) return;

    const z = Math.abs((observed - stats.mean) / stats.stddev);
    const isAnomaly = z > threshold;

    zScores.push(z);
    dimensions.push({
      dimension: name,
      observed: roundTo(observed, 2),
      expected: roundTo(stats.mean, 2),
      zScore: roundTo(z, 2),
      isAnomaly,
      description: isAnomaly
        ? `${label} ${roundTo(observed, 1)} is ${roundTo(z, 1)} std devs from average ${roundTo(stats.mean, 1)}`
        : `${label} within normal range`,
    });
  }

  // Duration
  let duration: number | null = null;
  if (trip.actualDurationSeconds) duration = trip.actualDurationSeconds / 60;
  else if (trip.durationMinutes) duration = trip.durationMinutes;
  checkDimension("duration", duration, model.features.duration, model.thresholds.duration, "Duration");

  // Distance
  let distance: number | null = null;
  if (trip.distanceMiles) distance = parseFloat(trip.distanceMiles);
  checkDimension("distance", distance, model.features.distance, model.thresholds.distance, "Distance");

  // Cost
  checkDimension("cost", trip.priceTotalCents, model.features.cost, model.thresholds.cost, "Cost");

  // Hour
  let hour: number | null = null;
  if (trip.startedAt) hour = new Date(trip.startedAt).getHours();
  else if (trip.pickupTime) {
    const match = trip.pickupTime.match(/^(\d{1,2}):/);
    if (match) hour = parseInt(match[1], 10);
  }
  checkDimension("hourOfDay", hour, model.features.hourOfDay, model.thresholds.hourOfDay, "Hour of day");

  // Day of week
  let dayOfWeek: number | null = null;
  if (trip.scheduledDate) dayOfWeek = new Date(trip.scheduledDate + "T12:00:00Z").getDay();
  checkDimension("dayOfWeek", dayOfWeek, model.features.dayOfWeek, model.thresholds.dayOfWeek, "Day of week");

  // Service type
  const serviceIdx = SERVICE_TYPE_MAP[trip.mobilityRequirement] ?? 0;
  checkDimension("serviceType", serviceIdx, model.features.serviceTypeIdx, model.thresholds.serviceTypeIdx, "Service type");

  // Compute overall anomaly score using Euclidean distance from centroid
  // Normalize z-scores and compute combined score
  const anomalousDimensions = dimensions.filter(d => d.isAnomaly);
  let anomalyScore = 0;

  if (zScores.length > 0) {
    // RMS of normalized z-scores, mapped to 0-1 via sigmoid
    const rms = Math.sqrt(zScores.reduce((s, z) => s + z * z, 0) / zScores.length);
    // Sigmoid mapping: score = 1 / (1 + e^(-(rms - threshold)))
    anomalyScore = 1 / (1 + Math.exp(-(rms - DEFAULT_Z_THRESHOLD)));
    anomalyScore = roundTo(anomalyScore, 4);
  }

  // Generate summary
  let summary: string;
  if (anomalousDimensions.length === 0) {
    summary = "Trip appears normal across all dimensions";
  } else if (anomalyScore > 0.8) {
    summary = `High anomaly detected: ${anomalousDimensions.map(d => d.dimension).join(", ")} deviate significantly from baseline`;
  } else if (anomalyScore > 0.5) {
    summary = `Moderate anomaly: ${anomalousDimensions.map(d => d.dimension).join(", ")} show unusual patterns`;
  } else {
    summary = `Minor anomaly: ${anomalousDimensions.map(d => d.dimension).join(", ")} slightly outside normal range`;
  }

  return {
    tripId,
    anomalyScore,
    dimensions,
    summary,
    modelInfo: {
      companyId: model.companyId,
      sampleSize: model.sampleSize,
      trainedAt: model.trainedAt,
    },
  };
}
