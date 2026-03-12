/**
 * Cancellation Prediction Engine
 *
 * Predicts which trips will be cancelled before they are by analyzing:
 * - Patient cancellation history rate
 * - Lead time (trips booked far in advance cancel more)
 * - Clinic type (some clinic types have higher cancel rates)
 * - Round-trip vs one-way (round trips cancel less)
 * - Unconfirmed status
 * - Recent pattern (patient cancelled last 2 trips = high risk)
 */

import { db } from "../db";
import { trips, clinics } from "@shared/schema";
import { eq, and, sql, gte, isNull, desc } from "drizzle-orm";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface CancellationPrediction {
  tripId: number;
  probability: number; // 0-100
  riskLevel: "low" | "medium" | "high" | "critical";
  factors: Array<{
    name: string;
    impact: number; // -20 to +20
    detail: string;
  }>;
  recommendedAction: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const LOOKBACK_DAYS = 90;
const BASE_CANCEL_RATE = 12; // baseline 12% cancellation probability

// ─── Core Prediction ────────────────────────────────────────────────────────

export async function predictCancellation(tripId: number): Promise<CancellationPrediction> {
  const [trip] = await db
    .select({
      id: trips.id,
      patientId: trips.patientId,
      clinicId: trips.clinicId,
      scheduledDate: trips.scheduledDate,
      pickupTime: trips.pickupTime,
      tripType: trips.tripType,
      confirmationStatus: trips.confirmationStatus,
      isRoundTrip: trips.isRoundTrip,
      pairedTripId: trips.pairedTripId,
      companyId: trips.companyId,
      createdAt: trips.createdAt,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), isNull(trips.deletedAt)))
    .limit(1);

  if (!trip) {
    return {
      tripId,
      probability: 0,
      riskLevel: "low",
      factors: [{ name: "Trip not found", impact: 0, detail: "Trip does not exist" }],
      recommendedAction: "No action needed",
    };
  }

  const factors: CancellationPrediction["factors"] = [];
  let probability = BASE_CANCEL_RATE;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  // ── Factor 1: Patient cancellation history rate ──
  const patientHistory = await db
    .select({
      total: sql<number>`count(*)::int`,
      cancelled: sql<number>`count(*) filter (where ${trips.status} = 'CANCELLED')::int`,
    })
    .from(trips)
    .where(
      and(
        eq(trips.patientId, trip.patientId),
        gte(trips.scheduledDate, cutoff),
        isNull(trips.deletedAt),
        sql`${trips.status} IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')`,
      ),
    );

  const hist = patientHistory[0];
  if (hist && hist.total > 0) {
    const cancelRate = hist.cancelled / hist.total;
    // Scale impact: 0% = -8, 20% = 0, 50%+ = +20
    const impact = Math.round(Math.min(20, Math.max(-8, (cancelRate - 0.15) * 60)));
    probability += impact;
    factors.push({
      name: "Patient cancellation history",
      impact,
      detail: `${hist.cancelled}/${hist.total} cancellations in last 90 days (${Math.round(cancelRate * 100)}%)`,
    });
  } else {
    factors.push({
      name: "Patient cancellation history",
      impact: 3,
      detail: "No trip history — new patient (slight uncertainty)",
    });
    probability += 3;
  }

  // ── Factor 2: Lead time (days from booking to scheduled date) ──
  if (trip.createdAt && trip.scheduledDate) {
    const createdDate = new Date(trip.createdAt);
    const scheduledDate = new Date(trip.scheduledDate + "T12:00:00Z");
    const leadDays = Math.round((scheduledDate.getTime() - createdDate.getTime()) / 86400000);

    if (leadDays > 14) {
      const impact = Math.min(12, Math.round((leadDays - 14) / 5) * 2);
      probability += impact;
      factors.push({
        name: "Lead time",
        impact,
        detail: `Booked ${leadDays} days in advance — longer lead times cancel more often`,
      });
    } else if (leadDays <= 1) {
      const impact = -5;
      probability += impact;
      factors.push({
        name: "Lead time",
        impact,
        detail: `Same-day or next-day booking — less likely to cancel`,
      });
    }
  }

  // ── Factor 3: Clinic cancellation rate ──
  if (trip.clinicId) {
    const clinicHistory = await db
      .select({
        total: sql<number>`count(*)::int`,
        cancelled: sql<number>`count(*) filter (where ${trips.status} = 'CANCELLED')::int`,
      })
      .from(trips)
      .where(
        and(
          eq(trips.clinicId, trip.clinicId),
          gte(trips.scheduledDate, cutoff),
          isNull(trips.deletedAt),
          sql`${trips.status} IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')`,
        ),
      );

    const ch = clinicHistory[0];
    if (ch && ch.total >= 10) {
      const clinicCancelRate = ch.cancelled / ch.total;
      // Compare to baseline
      const companyHistory = await db
        .select({
          total: sql<number>`count(*)::int`,
          cancelled: sql<number>`count(*) filter (where ${trips.status} = 'CANCELLED')::int`,
        })
        .from(trips)
        .where(
          and(
            eq(trips.companyId, trip.companyId),
            gte(trips.scheduledDate, cutoff),
            isNull(trips.deletedAt),
            sql`${trips.status} IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')`,
          ),
        );

      const co = companyHistory[0];
      const baselineRate = co && co.total > 0 ? co.cancelled / co.total : 0.12;
      const diff = clinicCancelRate - baselineRate;

      if (Math.abs(diff) > 0.05) {
        const impact = Math.round(Math.min(10, Math.max(-10, diff * 50)));
        probability += impact;

        // Get clinic name for detail
        const [clinic] = await db
          .select({ name: clinics.name })
          .from(clinics)
          .where(eq(clinics.id, trip.clinicId))
          .limit(1);

        factors.push({
          name: "Clinic cancellation rate",
          impact,
          detail: `${clinic?.name || "Clinic"}: ${Math.round(clinicCancelRate * 100)}% cancel rate (company avg: ${Math.round(baselineRate * 100)}%)`,
        });
      }
    }
  }

  // ── Factor 4: Round-trip vs one-way ──
  if (trip.isRoundTrip || trip.pairedTripId) {
    const impact = -8;
    probability += impact;
    factors.push({
      name: "Round-trip commitment",
      impact,
      detail: "Round-trip booking — patient is more committed to attending",
    });
  }

  // ── Factor 5: Confirmation status ──
  if (trip.confirmationStatus === "unconfirmed" || !trip.confirmationStatus) {
    const impact = 12;
    probability += impact;
    factors.push({
      name: "Trip confirmation",
      impact,
      detail: "Trip is unconfirmed — unconfirmed trips cancel at higher rates",
    });
  } else if (trip.confirmationStatus === "confirmed") {
    const impact = -8;
    probability += impact;
    factors.push({
      name: "Trip confirmation",
      impact,
      detail: "Trip is confirmed — significantly reduces cancellation risk",
    });
  }

  // ── Factor 6: Recent cancellation streak ──
  const recentTrips = await db
    .select({ status: trips.status })
    .from(trips)
    .where(
      and(
        eq(trips.patientId, trip.patientId),
        sql`${trips.scheduledDate} < ${trip.scheduledDate}`,
        isNull(trips.deletedAt),
        sql`${trips.status} IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')`,
      ),
    )
    .orderBy(desc(trips.scheduledDate))
    .limit(3);

  if (recentTrips.length >= 2) {
    const recentCancels = recentTrips.filter((t) => t.status === "CANCELLED").length;
    if (recentCancels >= 2) {
      const impact = 18;
      probability += impact;
      factors.push({
        name: "Recent cancellation streak",
        impact,
        detail: `Patient cancelled ${recentCancels} of last ${recentTrips.length} trips — high-risk pattern`,
      });
    }
  }

  // ── Factor 7: Recurring/dialysis trips cancel less ──
  if (trip.tripType === "dialysis") {
    const impact = -12;
    probability += impact;
    factors.push({
      name: "Appointment type",
      impact,
      detail: "Dialysis trip — critical care, very low cancellation rate",
    });
  } else if (trip.tripType === "recurring") {
    const impact = -5;
    probability += impact;
    factors.push({
      name: "Appointment type",
      impact,
      detail: "Recurring trip — established pattern, lower cancellation risk",
    });
  }

  // Clamp probability
  probability = Math.max(0, Math.min(100, Math.round(probability)));

  // Determine risk level
  let riskLevel: CancellationPrediction["riskLevel"];
  if (probability >= 70) riskLevel = "critical";
  else if (probability >= 50) riskLevel = "high";
  else if (probability >= 25) riskLevel = "medium";
  else riskLevel = "low";

  // Determine recommended action
  let recommendedAction: string;
  if (probability >= 70) {
    recommendedAction = "Call patient to confirm — consider booking backup trip";
  } else if (probability >= 50) {
    recommendedAction = "Send confirmation SMS/call to patient";
  } else if (probability >= 25) {
    recommendedAction = "Send automated reminder notification";
  } else {
    recommendedAction = "No special action needed";
  }

  return {
    tripId,
    probability,
    riskLevel,
    factors,
    recommendedAction,
  };
}
