/**
 * Patient Risk Stratification Engine
 *
 * Auto-generates care profiles for patients by analyzing:
 * - Transport reliability score (based on no-show/cancel history)
 * - Care complexity index (mobility requirements, trip frequency, distance)
 * - Social risk flags (isolation, long gaps, high no-show rate)
 * - Preferred driver (most frequently assigned)
 * - Communication preference (based on confirmation patterns)
 * - Key metrics (no-show rate, avg trips/month, last trip date)
 */

import { db } from "../db";
import { trips, patients, drivers } from "@shared/schema";
import { eq, and, sql, gte, isNull, desc } from "drizzle-orm";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PatientCareProfile {
  patientId: number;
  patientName: string;
  transportReliabilityScore: number; // 0-100
  careComplexityIndex: number; // 0-10
  socialRiskFlags: string[];
  preferredDriverId?: number;
  preferredDriverName?: string;
  communicationPreference: "sms" | "call" | "app";
  noShowRate: number;
  cancellationRate: number;
  avgTripsPerMonth: number;
  lastTripDate: string | null;
  totalTrips: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const LOOKBACK_DAYS = 180; // 6 months of history

// ─── Core Profile Builder ───────────────────────────────────────────────────

export async function buildPatientProfile(patientId: number): Promise<PatientCareProfile> {
  // Fetch patient info
  const [patient] = await db
    .select({
      id: patients.id,
      firstName: patients.firstName,
      lastName: patients.lastName,
      phone: patients.phone,
      email: patients.email,
      wheelchairRequired: patients.wheelchairRequired,
      preferredDriverId: patients.preferredDriverId,
      lat: patients.lat,
      lng: patients.lng,
      companyId: patients.companyId,
    })
    .from(patients)
    .where(eq(patients.id, patientId))
    .limit(1);

  if (!patient) {
    return {
      patientId,
      patientName: "Unknown",
      transportReliabilityScore: 50,
      careComplexityIndex: 0,
      socialRiskFlags: [],
      communicationPreference: "sms",
      noShowRate: 0,
      cancellationRate: 0,
      avgTripsPerMonth: 0,
      lastTripDate: null,
      totalTrips: 0,
    };
  }

  const patientName = `${patient.firstName} ${patient.lastName}`;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  // ── Fetch trip history summary ──
  const tripSummary = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${trips.status} = 'COMPLETED')::int`,
      noShows: sql<number>`count(*) filter (where ${trips.status} = 'NO_SHOW')::int`,
      cancelled: sql<number>`count(*) filter (where ${trips.status} = 'CANCELLED')::int`,
      confirmed: sql<number>`count(*) filter (where ${trips.confirmationStatus} = 'confirmed')::int`,
      wheelchair: sql<number>`count(*) filter (where ${trips.mobilityRequirement} != 'STANDARD')::int`,
      roundTrips: sql<number>`count(*) filter (where ${trips.isRoundTrip} = true)::int`,
      dialysis: sql<number>`count(*) filter (where ${trips.tripType} = 'dialysis')::int`,
      avgDistanceMiles: sql<number>`coalesce(avg(${trips.distanceMiles}::float), 0)::float`,
      distinctDates: sql<number>`count(distinct ${trips.scheduledDate})::int`,
      minDate: sql<string>`min(${trips.scheduledDate})`,
      maxDate: sql<string>`max(${trips.scheduledDate})`,
    })
    .from(trips)
    .where(
      and(
        eq(trips.patientId, patientId),
        gte(trips.scheduledDate, cutoff),
        isNull(trips.deletedAt),
      ),
    );

  const ts = tripSummary[0] || {
    total: 0,
    completed: 0,
    noShows: 0,
    cancelled: 0,
    confirmed: 0,
    wheelchair: 0,
    roundTrips: 0,
    dialysis: 0,
    avgDistanceMiles: 0,
    distinctDates: 0,
    minDate: null,
    maxDate: null,
  };

  const totalRelevant = ts.completed + ts.noShows + ts.cancelled;
  const noShowRate = totalRelevant > 0 ? ts.noShows / totalRelevant : 0;
  const cancellationRate = totalRelevant > 0 ? ts.cancelled / totalRelevant : 0;

  // Calculate avg trips per month
  let avgTripsPerMonth = 0;
  if (ts.minDate && ts.maxDate && ts.total > 0) {
    const firstDate = new Date(ts.minDate + "T12:00:00Z");
    const lastDate = new Date(ts.maxDate + "T12:00:00Z");
    const monthSpan = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / (30 * 86400000));
    avgTripsPerMonth = Math.round((ts.total / monthSpan) * 10) / 10;
  }

  // ── Transport Reliability Score (0-100) ──
  // Based on: show-up rate, confirmation rate, and cancellation rate
  let reliabilityScore = 70; // baseline

  if (totalRelevant > 0) {
    const showUpRate = ts.completed / totalRelevant;
    // showUpRate contributes 60% of score
    reliabilityScore = Math.round(showUpRate * 60);

    // Confirmation behavior contributes 20%
    const confirmRate = ts.total > 0 ? ts.confirmed / ts.total : 0.5;
    reliabilityScore += Math.round(confirmRate * 20);

    // Consistency (low cancel rate) contributes 20%
    reliabilityScore += Math.round((1 - cancellationRate) * 20);
  }

  reliabilityScore = Math.max(0, Math.min(100, reliabilityScore));

  // ── Care Complexity Index (0-10) ──
  let complexityIndex = 0;

  // Wheelchair/special mobility adds complexity
  if (patient.wheelchairRequired || (ts.wheelchair > 0 && ts.total > 0 && ts.wheelchair / ts.total > 0.3)) {
    complexityIndex += 3;
  }

  // High trip frequency = complex care needs
  if (avgTripsPerMonth >= 12) complexityIndex += 2;
  else if (avgTripsPerMonth >= 6) complexityIndex += 1;

  // Dialysis patients are high complexity
  if (ts.dialysis > 0 && ts.total > 0 && ts.dialysis / ts.total > 0.3) {
    complexityIndex += 2;
  }

  // Long average distances
  if (ts.avgDistanceMiles > 30) complexityIndex += 1.5;
  else if (ts.avgDistanceMiles > 15) complexityIndex += 0.5;

  // High no-show rate adds operational complexity
  if (noShowRate > 0.2) complexityIndex += 1;

  complexityIndex = Math.min(10, Math.round(complexityIndex * 10) / 10);

  // ── Social Risk Flags ──
  const socialRiskFlags: string[] = [];

  // High no-show rate
  if (noShowRate > 0.3) {
    socialRiskFlags.push("High no-show rate — potential access barrier");
  }

  // Long gap since last trip
  if (ts.maxDate) {
    const lastTripDate = new Date(ts.maxDate + "T12:00:00Z");
    const daysSinceLast = Math.round((new Date().getTime() - lastTripDate.getTime()) / 86400000);
    if (daysSinceLast > 60) {
      socialRiskFlags.push(`No trips for ${daysSinceLast} days — possible disengagement or health change`);
    }
  }

  // Frequent cancellations
  if (cancellationRate > 0.3) {
    socialRiskFlags.push("Frequent cancellations — may need care coordination support");
  }

  // No phone on file
  if (!patient.phone) {
    socialRiskFlags.push("No phone number — limited communication ability");
  }

  // No confirmation ever
  if (ts.total >= 5 && ts.confirmed === 0) {
    socialRiskFlags.push("Never confirms trips — may need alternative outreach");
  }

  // Low trip frequency with history of more
  if (avgTripsPerMonth < 1 && ts.total >= 5) {
    socialRiskFlags.push("Declining trip utilization — may indicate health improvement or barrier");
  }

  // ── Preferred Driver ──
  let preferredDriverId: number | undefined = patient.preferredDriverId ?? undefined;
  let preferredDriverName: string | undefined;

  // If no explicit preferred driver, find the most frequent one
  if (!preferredDriverId) {
    const topDriver = await db
      .select({
        driverId: trips.driverId,
        count: sql<number>`count(*)::int`,
      })
      .from(trips)
      .where(
        and(
          eq(trips.patientId, patientId),
          eq(trips.status, "COMPLETED"),
          sql`${trips.driverId} IS NOT NULL`,
          isNull(trips.deletedAt),
          gte(trips.scheduledDate, cutoff),
        ),
      )
      .groupBy(trips.driverId)
      .orderBy(desc(sql`count(*)`))
      .limit(1);

    if (topDriver.length > 0 && topDriver[0].count >= 3) {
      preferredDriverId = topDriver[0].driverId!;
    }
  }

  if (preferredDriverId) {
    const [driverInfo] = await db
      .select({ firstName: drivers.firstName, lastName: drivers.lastName })
      .from(drivers)
      .where(eq(drivers.id, preferredDriverId))
      .limit(1);

    if (driverInfo) {
      preferredDriverName = `${driverInfo.firstName} ${driverInfo.lastName}`;
    }
  }

  // ── Communication Preference ──
  // Infer from confirmation patterns and contact info
  let communicationPreference: "sms" | "call" | "app" = "sms";

  if (patient.email && !patient.phone) {
    communicationPreference = "app";
  } else if (ts.total >= 5 && ts.confirmed === 0 && patient.phone) {
    // Never confirms via SMS — might need a call
    communicationPreference = "call";
  }

  // Last trip date
  const lastTripDate = ts.maxDate || null;

  return {
    patientId,
    patientName,
    transportReliabilityScore: reliabilityScore,
    careComplexityIndex: complexityIndex,
    socialRiskFlags,
    preferredDriverId,
    preferredDriverName,
    communicationPreference,
    noShowRate: Math.round(noShowRate * 1000) / 1000,
    cancellationRate: Math.round(cancellationRate * 1000) / 1000,
    avgTripsPerMonth,
    lastTripDate,
    totalTrips: ts.total,
  };
}

// ─── Batch Profile Builder ──────────────────────────────────────────────────

export async function batchBuildProfiles(companyId: number): Promise<PatientCareProfile[]> {
  // Get all active patients for the company
  const activePatients = await db
    .select({ id: patients.id })
    .from(patients)
    .where(
      and(
        eq(patients.companyId, companyId),
        eq(patients.active, true),
        isNull(patients.deletedAt),
      ),
    );

  const profiles: PatientCareProfile[] = [];

  for (const patient of activePatients) {
    try {
      const profile = await buildPatientProfile(patient.id);
      profiles.push(profile);
    } catch (err: any) {
      console.warn(`[PATIENT-RISK] Failed for patient ${patient.id}: ${err.message}`);
    }
  }

  // Sort by reliability score ascending (most at-risk first)
  profiles.sort((a, b) => a.transportReliabilityScore - b.transportReliabilityScore);

  return profiles;
}
