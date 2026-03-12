/**
 * Dispatch Confidence Scoring Engine
 *
 * Every dispatch decision gets a confidence score with a detailed breakdown
 * across proximity, driver reliability, vehicle match, load balance,
 * patient history, and driver fatigue.
 */

import { db } from "../db";
import { trips, drivers, patients, isVehicleCompatible } from "@shared/schema";
import { eq, and, gte, isNull, sql } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DispatchConfidenceFactor {
  score: number;   // 0-100
  detail: string;
}

export interface DispatchConfidence {
  overallScore: number;      // 0-100
  confidence: "high" | "medium" | "low";  // >85=high, 60-85=medium, <60=low
  factors: {
    proximity: DispatchConfidenceFactor;
    driverScore: DispatchConfidenceFactor;
    vehicleMatch: DispatchConfidenceFactor;
    loadBalance: DispatchConfidenceFactor;
    patientHistory: DispatchConfidenceFactor;
    fatigue: DispatchConfidenceFactor;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function classifyConfidence(score: number): "high" | "medium" | "low" {
  if (score > 85) return "high";
  if (score >= 60) return "medium";
  return "low";
}

// Approximate driving time from straight-line distance (1.4x road factor, 30 km/h avg city)
function estimateDriveMinutes(distanceMeters: number): number {
  const roadDistance = distanceMeters * 1.4;
  return (roadDistance / 1000) / 30 * 60; // km / (km/h) * 60 = minutes
}

// ─── Main Scoring Function ────────────────────────────────────────────────────

const SHIFT_LIMIT_HOURS = 10;
const MAX_TRIPS_PER_DAY = 12;
const LOOKBACK_DAYS = 90;

export async function scoreDispatchDecision(
  tripId: number,
  driverId: number
): Promise<DispatchConfidence> {
  // Fetch trip and driver in parallel
  const [[trip], [driver]] = await Promise.all([
    db.select().from(trips).where(eq(trips.id, tripId)).limit(1),
    db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1),
  ]);

  if (!trip) throw new Error(`Trip ${tripId} not found`);
  if (!driver) throw new Error(`Driver ${driverId} not found`);

  // ── 1. Proximity Score ──────────────────────────────────────────────────

  let proximityScore = 0;
  let proximityDetail = "No GPS data available";

  if (driver.lastLat && driver.lastLng && trip.pickupLat && trip.pickupLng) {
    const distM = haversineMeters(
      driver.lastLat, driver.lastLng,
      Number(trip.pickupLat), Number(trip.pickupLng)
    );
    const driveMin = estimateDriveMinutes(distM);

    // Score: 100 at 0 min, 0 at 60+ min, linear
    proximityScore = Math.max(0, Math.min(100, 100 - (driveMin / 60) * 100));

    if (driveMin < 1) {
      proximityDetail = "Less than 1 min away";
    } else {
      proximityDetail = `${Math.round(driveMin)} min away (${(distM / 1000).toFixed(1)} km)`;
    }
  }

  // ── 2. Driver Reliability Score ─────────────────────────────────────────

  const statsResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
      COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'NO_SHOW', 'CANCELLED')) as total
    FROM trips
    WHERE driver_id = ${driverId}
      AND scheduled_date >= (CURRENT_DATE - INTERVAL '90 days')::text
      AND deleted_at IS NULL
  `);
  const statsRow = (statsResult as any).rows?.[0] || (statsResult as any)[0];
  const completedTrips = Number(statsRow?.completed || 0);
  const totalTrips = Number(statsRow?.total || 0);
  const onTimeRate = totalTrips > 0 ? completedTrips / totalTrips : 0.8;
  const driverReliabilityScore = Math.round(onTimeRate * 100);
  const driverScoreDetail = totalTrips > 0
    ? `${(onTimeRate * 100).toFixed(1)}% on-time, ${completedTrips} trips`
    : "New driver (no trip history)";

  // ── 3. Vehicle Match Score ──────────────────────────────────────────────

  const tripMobility = trip.mobilityRequirement || "AMBULATORY";
  const driverCap = driver.vehicleCapability || "sedan";
  const isCompatible = isVehicleCompatible(tripMobility, driverCap);

  let vehicleMatchScore = 0;
  let vehicleDetail = "";

  if (!isCompatible) {
    vehicleMatchScore = 0;
    vehicleDetail = `Incompatible: ${driverCap} cannot serve ${tripMobility}`;
  } else if (tripMobility === "WHEELCHAIR" && driverCap === "WHEELCHAIR") {
    vehicleMatchScore = 100;
    vehicleDetail = "WAV vehicle matches wheelchair need";
  } else if (tripMobility === "STRETCHER" && driverCap === "STRETCHER") {
    vehicleMatchScore = 100;
    vehicleDetail = "Stretcher vehicle matches stretcher need";
  } else if (["AMBULATORY", "STANDARD"].includes(tripMobility)) {
    vehicleMatchScore = 90;
    vehicleDetail = `Standard trip, driver has ${driverCap}`;
  } else {
    vehicleMatchScore = 70;
    vehicleDetail = `${driverCap} vehicle for ${tripMobility} trip`;
  }

  // ── 4. Load Balance Score ───────────────────────────────────────────────

  const loadResult = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM trips
    WHERE driver_id = ${driverId}
      AND scheduled_date = ${trip.scheduledDate}
      AND status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
      AND deleted_at IS NULL
  `);
  const loadRow = (loadResult as any).rows?.[0] || (loadResult as any)[0];
  const activeTripsToday = Number(loadRow?.cnt || 0);

  // Also get the average load for drivers in this city/company on this date
  const avgLoadResult = await db.execute(sql`
    SELECT COALESCE(AVG(cnt), 0) as avg_load FROM (
      SELECT driver_id, COUNT(*) as cnt FROM trips
      WHERE company_id = ${trip.companyId}
        AND scheduled_date = ${trip.scheduledDate}
        AND status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
        AND driver_id IS NOT NULL
        AND deleted_at IS NULL
      GROUP BY driver_id
    ) sub
  `);
  const avgLoadRow = (avgLoadResult as any).rows?.[0] || (avgLoadResult as any)[0];
  const avgLoad = Number(avgLoadRow?.avg_load || 3);

  const loadRatio = activeTripsToday / MAX_TRIPS_PER_DAY;
  const loadBalanceScore = Math.max(0, Math.min(100, Math.round((1 - loadRatio) * 100)));

  let loadDetail: string;
  if (activeTripsToday <= avgLoad) {
    loadDetail = `${activeTripsToday} trips today, below average (${avgLoad.toFixed(0)})`;
  } else {
    loadDetail = `${activeTripsToday} trips today, above average (${avgLoad.toFixed(0)})`;
  }

  // ── 5. Patient-Driver History Score ─────────────────────────────────────

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const historyResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
      COUNT(*) as total
    FROM trips
    WHERE driver_id = ${driverId}
      AND patient_id = ${trip.patientId}
      AND scheduled_date >= ${cutoffStr}
      AND deleted_at IS NULL
  `);
  const histRow = (historyResult as any).rows?.[0] || (historyResult as any)[0];
  const pairCompleted = Number(histRow?.completed || 0);
  const pairTotal = Number(histRow?.total || 0);

  let patientHistoryScore: number;
  let patientHistoryDetail: string;

  if (pairTotal === 0) {
    patientHistoryScore = 50; // neutral — no history
    patientHistoryDetail = "No previous trips with this patient";
  } else {
    const successRate = pairCompleted / pairTotal;
    // Base: success rate * 80, bonus for volume (up to +20)
    patientHistoryScore = Math.min(100, Math.round(
      successRate * 80 + Math.min(pairTotal, 10) * 2
    ));
    patientHistoryDetail = `Completed ${pairCompleted} trips with this patient` +
      (pairTotal > pairCompleted ? ` (${pairTotal} total, ${(successRate * 100).toFixed(0)}% success)` : ` with 100% satisfaction`);
  }

  // ── 6. Fatigue Score ────────────────────────────────────────────────────

  const hoursResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(
        EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) / 3600
      ), 0) as hours
    FROM trips
    WHERE driver_id = ${driverId}
      AND scheduled_date = CURRENT_DATE::text
      AND started_at IS NOT NULL
      AND status IN ('COMPLETED', 'IN_PROGRESS', 'EN_ROUTE_TO_DROPOFF', 'ARRIVED_DROPOFF')
      AND deleted_at IS NULL
  `);
  const hoursRow = (hoursResult as any).rows?.[0] || (hoursResult as any)[0];
  const hoursWorked = Number(hoursRow?.hours || 0);

  const fatigueRatio = hoursWorked / SHIFT_LIMIT_HOURS;
  const fatigueScore = Math.max(0, Math.min(100, Math.round((1 - fatigueRatio) * 100)));

  let fatigueDetail: string;
  if (hoursWorked < 4) {
    fatigueDetail = `${hoursWorked.toFixed(1)}h worked, low fatigue risk`;
  } else if (hoursWorked < 7) {
    fatigueDetail = `${hoursWorked.toFixed(1)}h worked, moderate fatigue`;
  } else {
    fatigueDetail = `${hoursWorked.toFixed(1)}h worked, high fatigue risk`;
  }

  // ── Compute Overall Score ───────────────────────────────────────────────

  // Weighted average — proximity and driver reliability count most
  const weights = {
    proximity: 0.25,
    driverScore: 0.20,
    vehicleMatch: 0.20,
    loadBalance: 0.12,
    patientHistory: 0.13,
    fatigue: 0.10,
  };

  const overallScore = Math.round(
    proximityScore * weights.proximity +
    driverReliabilityScore * weights.driverScore +
    vehicleMatchScore * weights.vehicleMatch +
    loadBalanceScore * weights.loadBalance +
    patientHistoryScore * weights.patientHistory +
    fatigueScore * weights.fatigue
  );

  return {
    overallScore,
    confidence: classifyConfidence(overallScore),
    factors: {
      proximity: { score: proximityScore, detail: proximityDetail },
      driverScore: { score: driverReliabilityScore, detail: driverScoreDetail },
      vehicleMatch: { score: vehicleMatchScore, detail: vehicleDetail },
      loadBalance: { score: loadBalanceScore, detail: loadDetail },
      patientHistory: { score: patientHistoryScore, detail: patientHistoryDetail },
      fatigue: { score: fatigueScore, detail: fatigueDetail },
    },
  };
}
