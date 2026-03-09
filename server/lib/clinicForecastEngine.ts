import { db } from "../db";
import { trips, clinicCapacityConfig, clinicForecastSnapshots } from "@shared/schema";
import { eq, and, isNull, inArray, gte, sql } from "drizzle-orm";
import { nowInCity, cityNowDate } from "@shared/timeUtils";
import { format } from "date-fns";

export interface ForecastBucket {
  bucketStart: string;
  bucketEnd: string;
  inboundAmb: number;
  inboundWc: number;
  outboundAmb: number;
  outboundWc: number;
  totalDemand: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  meta: {
    baselineSamplesCount: number;
    last7daysAdjustmentFactor: number;
    confidenceReason: string;
  };
}

export interface CapacityBucket {
  bucketStart: string;
  bucketEnd: string;
  driversNeededAmb: number;
  driversNeededWc: number;
  driversNeededTotal: number;
  shortageRisk: boolean;
  message: string | null;
}

export interface CapacityForecastResult {
  buckets: CapacityBucket[];
  shortages: Array<{ window: string; type: string; needed: number; message: string }>;
  config: { ambCycleMin: number; wcCycleMin: number };
}

const CONFIDENCE_THRESHOLDS = { LOW: 3, MEDIUM: 8, HIGH: 20 };
const BUCKET_SIZE_MINUTES = 15;

function getTimeBucket(timeStr: string): string {
  if (!timeStr) return "00:00";
  const parts = timeStr.split(":");
  const h = parseInt(parts[0] || "0");
  const m = parseInt(parts[1] || "0");
  const bucketM = Math.floor(m / BUCKET_SIZE_MINUTES) * BUCKET_SIZE_MINUTES;
  return `${String(h).padStart(2, "0")}:${String(bucketM).padStart(2, "0")}`;
}

function generateBuckets(cityNow: Date, horizonMinutes: number): string[] {
  const buckets: string[] = [];
  // cityNow is already in the clinic's local time (via nowInCity)
  const startH = cityNow.getHours();
  const startM = Math.floor(cityNow.getMinutes() / BUCKET_SIZE_MINUTES) * BUCKET_SIZE_MINUTES;
  let totalMinutes = startH * 60 + startM;
  const endMinutes = totalMinutes + horizonMinutes;
  while (totalMinutes < endMinutes) {
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    buckets.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    totalMinutes += BUCKET_SIZE_MINUTES;
  }
  return buckets;
}

function isInbound(trip: any, clinicId: number): boolean {
  if (trip.dropoffAddress && trip.pickupAddress) {
    return trip.clinicId === clinicId;
  }
  return true;
}

export async function getClinicForecast(
  clinicId: number,
  horizonMinutes: number = 180,
  bucketMinutes: number = 15,
  clinicTimezone: string = "America/Los_Angeles"
): Promise<ForecastBucket[]> {
  const cityNow = nowInCity(clinicTimezone);
  const todayDow = cityNow.getDay();
  const bucketStarts = generateBuckets(cityNow, horizonMinutes);

  const now = new Date();
  const last90DaysDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const last90Str = last90DaysDate.toISOString().split("T")[0];
  const last7DaysDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last7Str = last7DaysDate.toISOString().split("T")[0];

  const historicalTrips = await db.select({
    scheduledDate: trips.scheduledDate,
    pickupTime: trips.pickupTime,
    scheduledTime: trips.scheduledTime,
    mobilityRequirement: trips.mobilityRequirement,
    clinicId: trips.clinicId,
    status: trips.status,
    pickupAddress: trips.pickupAddress,
    dropoffAddress: trips.dropoffAddress,
  }).from(trips).where(
    and(
      eq(trips.clinicId, clinicId),
      isNull(trips.deletedAt),
      gte(trips.scheduledDate, last90Str),
      inArray(trips.status, ["COMPLETED", "SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"])
    )
  );

  const todayStr = cityNowDate(clinicTimezone);
  const todayScheduled = historicalTrips.filter(t => t.scheduledDate === todayStr);

  const sameDowTrips = historicalTrips.filter(t => {
    const d = new Date(t.scheduledDate + "T00:00:00");
    return d.getDay() === todayDow && t.scheduledDate !== todayStr;
  });

  const recent7Trips = historicalTrips.filter(t => t.scheduledDate >= last7Str && t.scheduledDate !== todayStr);

  const baselineMap = new Map<string, { inbAmb: number; inbWc: number; outAmb: number; outWc: number; count: number }>();
  const recentMap = new Map<string, { inbAmb: number; inbWc: number; outAmb: number; outWc: number; count: number }>();

  function addToBucketMap(
    map: Map<string, { inbAmb: number; inbWc: number; outAmb: number; outWc: number; count: number }>,
    trip: any,
    dayCount: number
  ) {
    const time = trip.scheduledTime || trip.pickupTime || "00:00";
    const bucket = getTimeBucket(time);
    const entry = map.get(bucket) || { inbAmb: 0, inbWc: 0, outAmb: 0, outWc: 0, count: 0 };
    const inbound = isInbound(trip, clinicId);
    const isWc = trip.mobilityRequirement === "WHEELCHAIR";

    if (inbound) {
      if (isWc) entry.inbWc += 1 / dayCount;
      else entry.inbAmb += 1 / dayCount;
    } else {
      if (isWc) entry.outWc += 1 / dayCount;
      else entry.outAmb += 1 / dayCount;
    }
    entry.count++;
    map.set(bucket, entry);
  }

  const sameDowDayCount = new Set(sameDowTrips.map(t => t.scheduledDate)).size || 1;
  for (const trip of sameDowTrips) {
    addToBucketMap(baselineMap, trip, sameDowDayCount);
  }

  const recent7DayCount = new Set(recent7Trips.map(t => t.scheduledDate)).size || 1;
  for (const trip of recent7Trips) {
    addToBucketMap(recentMap, trip, recent7DayCount);
  }

  const todayMap = new Map<string, { inbAmb: number; inbWc: number; outAmb: number; outWc: number }>();
  for (const trip of todayScheduled) {
    const time = trip.scheduledTime || trip.pickupTime || "00:00";
    const bucket = getTimeBucket(time);
    const entry = todayMap.get(bucket) || { inbAmb: 0, inbWc: 0, outAmb: 0, outWc: 0 };
    const inbound = isInbound(trip, clinicId);
    const isWc = trip.mobilityRequirement === "WHEELCHAIR";
    if (inbound) { if (isWc) entry.inbWc++; else entry.inbAmb++; }
    else { if (isWc) entry.outWc++; else entry.outAmb++; }
    todayMap.set(bucket, entry);
  }

  const results: ForecastBucket[] = [];

  for (let i = 0; i < bucketStarts.length; i++) {
    const bucketStart = bucketStarts[i];
    const parts = bucketStart.split(":");
    const endMinutes = parseInt(parts[0]) * 60 + parseInt(parts[1]) + BUCKET_SIZE_MINUTES;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;
    const bucketEnd = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

    const baseline = baselineMap.get(bucketStart) || { inbAmb: 0, inbWc: 0, outAmb: 0, outWc: 0, count: 0 };
    const recent = recentMap.get(bucketStart) || { inbAmb: 0, inbWc: 0, outAmb: 0, outWc: 0, count: 0 };
    const today = todayMap.get(bucketStart) || { inbAmb: 0, inbWc: 0, outAmb: 0, outWc: 0 };

    let adjustmentFactor = 1.0;
    if (baseline.count > 0 && recent.count > 0) {
      const baselineTotal = baseline.inbAmb + baseline.inbWc + baseline.outAmb + baseline.outWc;
      const recentTotal = recent.inbAmb + recent.inbWc + recent.outAmb + recent.outWc;
      if (baselineTotal > 0) {
        adjustmentFactor = recentTotal / baselineTotal;
        adjustmentFactor = Math.max(0.5, Math.min(2.0, adjustmentFactor));
      }
    }

    const hasScheduledToday = today.inbAmb + today.inbWc + today.outAmb + today.outWc > 0;

    let inboundAmb: number, inboundWc: number, outboundAmb: number, outboundWc: number;

    if (hasScheduledToday) {
      inboundAmb = today.inbAmb;
      inboundWc = today.inbWc;
      outboundAmb = today.outAmb;
      outboundWc = today.outWc;

      if (baseline.count > 0) {
        inboundAmb = Math.max(inboundAmb, Math.round(baseline.inbAmb * adjustmentFactor));
        inboundWc = Math.max(inboundWc, Math.round(baseline.inbWc * adjustmentFactor));
        outboundAmb = Math.max(outboundAmb, Math.round(baseline.outAmb * adjustmentFactor));
        outboundWc = Math.max(outboundWc, Math.round(baseline.outWc * adjustmentFactor));
      }
    } else {
      inboundAmb = Math.round(baseline.inbAmb * adjustmentFactor);
      inboundWc = Math.round(baseline.inbWc * adjustmentFactor);
      outboundAmb = Math.round(baseline.outAmb * adjustmentFactor);
      outboundWc = Math.round(baseline.outWc * adjustmentFactor);
    }

    const totalSamples = baseline.count + recent.count;
    let confidence: "LOW" | "MEDIUM" | "HIGH" = "LOW";
    let confidenceReason = "Insufficient historical data";

    if (totalSamples >= CONFIDENCE_THRESHOLDS.HIGH) {
      confidence = "HIGH";
      confidenceReason = `Strong baseline: ${totalSamples} samples across historical + recent data`;
    } else if (totalSamples >= CONFIDENCE_THRESHOLDS.MEDIUM) {
      confidence = "MEDIUM";
      confidenceReason = `Moderate baseline: ${totalSamples} samples`;
    } else if (hasScheduledToday) {
      confidence = "MEDIUM";
      confidenceReason = `Based on today's schedule (${today.inbAmb + today.inbWc + today.outAmb + today.outWc} trips) with limited history`;
    } else {
      confidenceReason = `Low history: only ${totalSamples} samples`;
    }

    results.push({
      bucketStart,
      bucketEnd,
      inboundAmb,
      inboundWc,
      outboundAmb,
      outboundWc,
      totalDemand: inboundAmb + inboundWc + outboundAmb + outboundWc,
      confidence,
      meta: {
        baselineSamplesCount: baseline.count,
        last7daysAdjustmentFactor: Math.round(adjustmentFactor * 100) / 100,
        confidenceReason,
      },
    });
  }

  return results;
}

export async function getClinicCapacityForecast(
  clinicId: number,
  forecastBuckets?: ForecastBucket[]
): Promise<CapacityForecastResult> {
  const buckets = forecastBuckets || await getClinicForecast(clinicId);

  const configRows = await db.select().from(clinicCapacityConfig).where(eq(clinicCapacityConfig.clinicId, clinicId));
  const configMap = new Map(configRows.map(r => [r.serviceLevel, r.avgCycleMinutes]));
  const ambCycleMin = configMap.get("ambulatory") || configMap.get("STANDARD") || 30;
  const wcCycleMin = configMap.get("wheelchair") || configMap.get("WHEELCHAIR") || 45;

  const capacityBuckets: CapacityBucket[] = [];
  const shortages: CapacityForecastResult["shortages"] = [];

  for (const b of buckets) {
    const driversAmb = Math.ceil((b.inboundAmb + b.outboundAmb) * ambCycleMin / BUCKET_SIZE_MINUTES);
    const driversWc = Math.ceil((b.inboundWc + b.outboundWc) * wcCycleMin / BUCKET_SIZE_MINUTES);
    const driversTotal = driversAmb + driversWc;

    const shortageRisk = driversTotal > 0 && b.totalDemand > 2;

    let message: string | null = null;
    if (driversWc > 0) {
      message = `Need ${driversWc} wheelchair driver${driversWc > 1 ? "s" : ""} ${b.bucketStart}–${b.bucketEnd}`;
      if (shortageRisk) {
        shortages.push({
          window: `${b.bucketStart}–${b.bucketEnd}`,
          type: "wheelchair",
          needed: driversWc,
          message,
        });
      }
    }
    if (driversAmb > 1) {
      const ambMsg = `Need ${driversAmb} ambulatory driver${driversAmb > 1 ? "s" : ""} ${b.bucketStart}–${b.bucketEnd}`;
      if (!message) message = ambMsg;
      if (shortageRisk) {
        shortages.push({
          window: `${b.bucketStart}–${b.bucketEnd}`,
          type: "ambulatory",
          needed: driversAmb,
          message: ambMsg,
        });
      }
    }

    capacityBuckets.push({
      bucketStart: b.bucketStart,
      bucketEnd: b.bucketEnd,
      driversNeededAmb: driversAmb,
      driversNeededWc: driversWc,
      driversNeededTotal: driversTotal,
      shortageRisk,
      message,
    });
  }

  return {
    buckets: capacityBuckets,
    shortages,
    config: { ambCycleMin, wcCycleMin },
  };
}

export async function saveClinicForecastSnapshot(clinicId: number, clinicTimezone: string = "America/Los_Angeles"): Promise<void> {
  const forecast = await getClinicForecast(clinicId, 180, 15, clinicTimezone);
  const capacity = await getClinicCapacityForecast(clinicId, forecast);
  const todayStr = cityNowDate(clinicTimezone);

  const peakBucket = forecast.reduce((max, b) => b.totalDemand > max.totalDemand ? b : max, forecast[0]);

  await db.insert(clinicForecastSnapshots).values({
    clinicId,
    snapshotDate: todayStr,
    forecastData: forecast as any,
    capacityData: capacity as any,
    metadata: {
      generatedAt: new Date().toISOString(),
      totalBuckets: forecast.length,
      peakWindow: peakBucket ? `${peakBucket.bucketStart}–${peakBucket.bucketEnd}` : null,
      peakDemand: peakBucket?.totalDemand || 0,
      totalShortages: capacity.shortages.length,
    },
  });
}
