/**
 * Smart Pickup Suggestion Engine
 * Uses historical trip data, traffic patterns, and distance estimates
 * to suggest optimal pickup times for clinic appointments.
 */
import { db } from "../db";
import { trips, patients, clinics, smartPickupSuggestions } from "@shared/schema";
import { eq, and, gte, isNull, sql, desc } from "drizzle-orm";
import { cityNowDate, nowInCity } from "@shared/timeUtils";

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_BUFFER_MINUTES = 15;
const MIN_BUFFER_MINUTES = 10;
const MAX_BUFFER_MINUTES = 60;
const HISTORICAL_LOOKBACK_DAYS = 90;
const MINIMUM_SAMPLES = 3;
const RUSH_HOUR_FACTOR = 1.3;
const WHEELCHAIR_EXTRA_MINUTES = 10;
const APPOINTMENT_DURATION_DEFAULT = 60; // minutes

// ─── Time-of-day traffic factor ──────────────────────────────────────────────

function getTrafficFactor(hour: number): number {
  // Empirical traffic multipliers by hour
  if (hour >= 7 && hour <= 9) return 1.35;   // Morning rush
  if (hour >= 16 && hour <= 18) return 1.30;  // Evening rush
  if (hour >= 11 && hour <= 13) return 1.15;  // Lunch hour
  if (hour >= 6 && hour <= 7) return 1.10;    // Early morning
  if (hour >= 20 || hour <= 5) return 0.85;   // Night (less traffic)
  return 1.0; // Normal
}

// ─── Day-of-week factor ──────────────────────────────────────────────────────

function getDayFactor(dayOfWeek: number): number {
  // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  if (dayOfWeek === 0) return 0.80;  // Sunday - light traffic
  if (dayOfWeek === 6) return 0.85;  // Saturday - light traffic
  if (dayOfWeek === 1) return 1.10;  // Monday - heavier
  if (dayOfWeek === 5) return 1.10;  // Friday - heavier
  return 1.0; // Tue-Thu normal
}

// ─── Historical Travel Time Analysis ─────────────────────────────────────────

interface TravelStats {
  avgMinutes: number;
  p75Minutes: number;
  p90Minutes: number;
  sampleCount: number;
}

async function getHistoricalTravelTime(
  patientId: number,
  clinicId: number
): Promise<TravelStats | null> {
  const lookbackDate = new Date(Date.now() - HISTORICAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().split("T")[0];

  // Get completed trips between patient and clinic
  const completedTrips = await db.select({
    scheduledTime: trips.scheduledTime,
    pickupTime: trips.pickupTime,
    durationMinutes: trips.durationMinutes,
    actualDurationSeconds: trips.actualDurationSeconds,
    distanceMiles: trips.distanceMiles,
  }).from(trips).where(
    and(
      eq(trips.patientId, patientId),
      eq(trips.clinicId, clinicId),
      eq(trips.status, "COMPLETED"),
      gte(trips.scheduledDate, lookbackDate),
      isNull(trips.deletedAt)
    )
  );

  if (completedTrips.length < MINIMUM_SAMPLES) return null;

  // Calculate travel times from available data
  const durations: number[] = [];
  for (const t of completedTrips) {
    if (t.actualDurationSeconds) {
      durations.push(Math.round(t.actualDurationSeconds / 60));
    } else if (t.durationMinutes) {
      durations.push(t.durationMinutes);
    }
  }

  if (durations.length === 0) return null;

  durations.sort((a, b) => a - b);
  const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
  const p75Idx = Math.floor(durations.length * 0.75);
  const p90Idx = Math.floor(durations.length * 0.90);

  return {
    avgMinutes: Math.round(avg),
    p75Minutes: Math.round(durations[p75Idx] || avg),
    p90Minutes: Math.round(durations[p90Idx] || avg),
    sampleCount: durations.length,
  };
}

// ─── Distance-Based Estimate (Fallback) ──────────────────────────────────────

function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function estimateTravelMinutesFromDistance(miles: number, trafficFactor: number): number {
  // Average speed: 25mph in urban, adjusted for traffic
  const avgSpeedMph = 25 / trafficFactor;
  return Math.round((miles / avgSpeedMph) * 60);
}

// ─── Main Suggestion Generator ───────────────────────────────────────────────

export interface PickupSuggestion {
  suggestedPickupTime: string;
  suggestedReturnTime: string | null;
  estimatedTravelMinutes: number;
  confidenceScore: number;
  factors: {
    avgTravelMin: number;
    trafficFactor: number;
    dayFactor: number;
    bufferMinutes: number;
    historicalSamples: number;
    mobilityExtra: number;
    method: "historical" | "distance" | "default";
  };
}

export async function suggestPickupTime(
  clinicId: number,
  patientId: number,
  appointmentDate: string,
  appointmentTime: string,
  clinicTimezone: string = "America/Los_Angeles"
): Promise<PickupSuggestion> {
  const [apptH, apptM] = appointmentTime.split(":").map(Number);
  const apptDay = new Date(appointmentDate + "T12:00:00").getDay();
  const trafficFactor = getTrafficFactor(apptH);
  const dayFactor = getDayFactor(apptDay);

  // Get patient & clinic for coordinates and mobility
  const [patient] = await db.select().from(patients).where(eq(patients.id, patientId));
  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId));

  const isWheelchair = (patient as any)?.mobilityType === "WHEELCHAIR";
  const mobilityExtra = isWheelchair ? WHEELCHAIR_EXTRA_MINUTES : 0;

  // Strategy 1: Historical data
  const stats = await getHistoricalTravelTime(patientId, clinicId);
  let travelMinutes: number;
  let confidence: number;
  let method: "historical" | "distance" | "default";

  if (stats && stats.sampleCount >= MINIMUM_SAMPLES) {
    // Use p75 for safe estimate (75th percentile)
    travelMinutes = Math.round(stats.p75Minutes * trafficFactor * dayFactor);
    confidence = Math.min(0.95, 0.5 + (stats.sampleCount / 50));
    method = "historical";
  } else if (
    patient && clinic &&
    (patient as any).lat && (patient as any).lng &&
    (clinic as any).lat && (clinic as any).lng
  ) {
    // Strategy 2: Distance-based estimate
    const distance = haversineDistanceMiles(
      (patient as any).lat, (patient as any).lng,
      (clinic as any).lat, (clinic as any).lng
    );
    travelMinutes = estimateTravelMinutesFromDistance(distance, trafficFactor * dayFactor);
    confidence = 0.5;
    method = "distance";
  } else {
    // Strategy 3: Default
    travelMinutes = 30;
    confidence = 0.25;
    method = "default";
  }

  // Apply buffer
  const bufferMinutes = Math.min(
    MAX_BUFFER_MINUTES,
    Math.max(MIN_BUFFER_MINUTES, Math.round(travelMinutes * 0.25))
  );

  const totalLeadMinutes = travelMinutes + bufferMinutes + mobilityExtra;
  const pickupTotalMin = apptH * 60 + apptM - totalLeadMinutes;
  const pickupH = Math.max(0, Math.floor(pickupTotalMin / 60));
  const pickupMin = Math.max(0, pickupTotalMin % 60);
  const suggestedPickupTime = `${String(pickupH).padStart(2, "0")}:${String(pickupMin).padStart(2, "0")}`;

  // Suggest return time (appointment end + buffer)
  const apptEndMin = apptH * 60 + apptM + APPOINTMENT_DURATION_DEFAULT;
  const returnTotalMin = apptEndMin + bufferMinutes;
  const returnH = Math.floor(returnTotalMin / 60) % 24;
  const returnMin = returnTotalMin % 60;
  const suggestedReturnTime = `${String(returnH).padStart(2, "0")}:${String(returnMin).padStart(2, "0")}`;

  const result: PickupSuggestion = {
    suggestedPickupTime,
    suggestedReturnTime,
    estimatedTravelMinutes: travelMinutes,
    confidenceScore: Math.round(confidence * 100) / 100,
    factors: {
      avgTravelMin: stats?.avgMinutes || travelMinutes,
      trafficFactor: Math.round(trafficFactor * dayFactor * 100) / 100,
      dayFactor,
      bufferMinutes,
      historicalSamples: stats?.sampleCount || 0,
      mobilityExtra,
      method,
    },
  };

  // Save suggestion to DB
  try {
    await db.insert(smartPickupSuggestions).values({
      clinicId,
      patientId,
      appointmentDate,
      appointmentTime,
      suggestedPickupTime: result.suggestedPickupTime,
      suggestedReturnTime: result.suggestedReturnTime,
      estimatedTravelMinutes: result.estimatedTravelMinutes,
      confidenceScore: result.confidenceScore,
      factors: result.factors as any,
    });
  } catch (err) {
    console.error("[SMART_PICKUP] Save suggestion error:", err);
  }

  return result;
}

// ─── Batch Suggestions for Clinic Day ────────────────────────────────────────

export async function suggestPickupsForClinicDay(
  clinicId: number,
  date: string,
  clinicTimezone: string = "America/Los_Angeles"
): Promise<Array<{ patientId: number; appointmentTime: string; suggestion: PickupSuggestion }>> {
  // Get all scheduled trips for this clinic on this date
  const scheduledTrips = await db.select({
    id: trips.id,
    patientId: trips.patientId,
    scheduledTime: trips.scheduledTime,
  }).from(trips).where(
    and(
      eq(trips.clinicId, clinicId),
      eq(trips.scheduledDate, date),
      isNull(trips.deletedAt),
      eq(trips.status, "SCHEDULED")
    )
  );

  const results: Array<{ patientId: number; appointmentTime: string; suggestion: PickupSuggestion }> = [];

  for (const trip of scheduledTrips) {
    if (!trip.patientId || !trip.scheduledTime) continue;

    try {
      const suggestion = await suggestPickupTime(
        clinicId,
        trip.patientId,
        date,
        trip.scheduledTime,
        clinicTimezone
      );
      results.push({
        patientId: trip.patientId,
        appointmentTime: trip.scheduledTime,
        suggestion,
      });
    } catch (err) {
      console.error(`[SMART_PICKUP] Error for patient ${trip.patientId}:`, err);
    }
  }

  return results;
}
