/**
 * No-Show Prediction Engine
 *
 * Scores every upcoming trip 0-100 for no-show probability by analyzing:
 * - Patient no-show history (last 90 days)
 * - Day-of-week patterns per patient
 * - Time-of-day patterns (morning vs afternoon)
 * - Appointment type (dialysis patients rarely no-show)
 * - Days since last trip (long gaps = higher risk)
 * - Distance from home (longer = slightly higher risk)
 * - Trip confirmation status
 * - Weather multiplier (configurable placeholder)
 */

import { db } from "../db";
import { trips, patients, clinics } from "@shared/schema";
import { eq, and, sql, gte, isNull, desc } from "drizzle-orm";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface NoShowPrediction {
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

// ─── Configuration ──────────────────────────────────────────────────────────

const LOOKBACK_DAYS = 90;
const BASE_NO_SHOW_RATE = 15; // baseline 15% no-show probability
/**
 * Compute a seasonal/environmental risk multiplier based on month and day.
 * Winter months (Dec-Feb) have higher no-show risk due to weather.
 * Extreme heat months (Jul-Aug) also increase risk slightly.
 * First-of-month has lower risk (dialysis/recurring appointments).
 */
function computeEnvironmentalMultiplier(scheduledDate: string): number {
  const date = new Date(scheduledDate + "T12:00:00Z");
  const month = date.getMonth(); // 0-11
  let multiplier = 1.0;

  // Winter weather risk (Dec=11, Jan=0, Feb=1)
  if (month === 11 || month === 0 || month === 1) {
    multiplier = 1.15; // 15% higher no-show risk in winter
  }
  // Summer heat risk (Jul=6, Aug=7)
  else if (month === 6 || month === 7) {
    multiplier = 1.08; // 8% higher in peak summer
  }
  // Spring/Fall are baseline
  return multiplier;
}

// ─── Haversine ──────────────────────────────────────────────────────────────

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Core Prediction ────────────────────────────────────────────────────────

export async function predictNoShow(tripId: number): Promise<NoShowPrediction> {
  // Fetch the trip with patient and clinic info
  const [trip] = await db
    .select({
      id: trips.id,
      patientId: trips.patientId,
      clinicId: trips.clinicId,
      scheduledDate: trips.scheduledDate,
      pickupTime: trips.pickupTime,
      tripType: trips.tripType,
      serviceType: trips.serviceType,
      confirmationStatus: trips.confirmationStatus,
      isRoundTrip: trips.isRoundTrip,
      pickupLat: trips.pickupLat,
      pickupLng: trips.pickupLng,
      companyId: trips.companyId,
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

  const factors: NoShowPrediction["factors"] = [];
  let probability = BASE_NO_SHOW_RATE;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  // ── Factor 1: Patient no-show history (last 90 days) ──
  const patientHistory = await db
    .select({
      total: sql<number>`count(*)::int`,
      noShows: sql<number>`count(*) filter (where ${trips.status} = 'NO_SHOW')::int`,
    })
    .from(trips)
    .where(
      and(
        eq(trips.patientId, trip.patientId),
        gte(trips.scheduledDate, cutoff),
        isNull(trips.deletedAt),
        sql`${trips.status} IN ('COMPLETED', 'NO_SHOW', 'CANCELLED')`,
      ),
    );

  const hist = patientHistory[0];
  if (hist && hist.total > 0) {
    const noShowRate = hist.noShows / hist.total;
    // Scale: 0% history = -10 impact, 50%+ history = +20 impact
    const impact = Math.round(Math.min(20, Math.max(-10, (noShowRate - 0.1) * 60)));
    probability += impact;
    factors.push({
      name: "Patient no-show history",
      impact,
      detail: `${hist.noShows}/${hist.total} no-shows in last 90 days (${Math.round(noShowRate * 100)}%)`,
    });
  } else {
    // New patient — slightly higher risk due to unknown behavior
    factors.push({
      name: "Patient no-show history",
      impact: 5,
      detail: "No trip history — new patient (slight uncertainty)",
    });
    probability += 5;
  }

  // ── Factor 2: Day-of-week pattern ──
  if (trip.scheduledDate) {
    const targetDow = new Date(trip.scheduledDate + "T12:00:00Z").getDay();

    const dowHistory = await db
      .select({
        total: sql<number>`count(*)::int`,
        noShows: sql<number>`count(*) filter (where ${trips.status} = 'NO_SHOW')::int`,
      })
      .from(trips)
      .where(
        and(
          eq(trips.patientId, trip.patientId),
          gte(trips.scheduledDate, cutoff),
          isNull(trips.deletedAt),
          sql`extract(dow from ${trips.scheduledDate}::date) = ${targetDow}`,
          sql`${trips.status} IN ('COMPLETED', 'NO_SHOW', 'CANCELLED')`,
        ),
      );

    const dow = dowHistory[0];
    if (dow && dow.total >= 3) {
      const dowRate = dow.noShows / dow.total;
      const baseRate = hist && hist.total > 0 ? hist.noShows / hist.total : 0.1;
      const diff = dowRate - baseRate;
      const impact = Math.round(Math.min(10, Math.max(-10, diff * 50)));
      if (Math.abs(impact) >= 2) {
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        probability += impact;
        factors.push({
          name: "Day-of-week pattern",
          impact,
          detail: `${Math.round(dowRate * 100)}% no-show rate on ${dayNames[targetDow]}s (${dow.noShows}/${dow.total})`,
        });
      }
    }
  }

  // ── Factor 3: Time-of-day pattern ──
  if (trip.pickupTime) {
    const hourMatch = trip.pickupTime.match(/^(\d{1,2}):/);
    if (hourMatch) {
      const hour = parseInt(hourMatch[1], 10);
      // Early morning (before 8) and late afternoon (after 16) have higher no-show rates
      let impact = 0;
      let detail = "";
      if (hour < 7) {
        impact = 8;
        detail = `Early morning pickup (${trip.pickupTime}) — higher no-show risk`;
      } else if (hour >= 7 && hour <= 9) {
        impact = -3;
        detail = `Morning pickup (${trip.pickupTime}) — patients tend to show up`;
      } else if (hour >= 13 && hour <= 15) {
        impact = 3;
        detail = `Early afternoon pickup (${trip.pickupTime}) — slightly elevated risk`;
      } else if (hour >= 17) {
        impact = 5;
        detail = `Late afternoon/evening pickup (${trip.pickupTime}) — higher no-show risk`;
      } else {
        impact = 0;
        detail = `Mid-day pickup (${trip.pickupTime}) — average risk`;
      }

      if (impact !== 0) {
        probability += impact;
        factors.push({ name: "Time of day", impact, detail });
      }
    }
  }

  // ── Factor 4: Appointment type ──
  if (trip.tripType === "dialysis") {
    const impact = -15;
    probability += impact;
    factors.push({
      name: "Appointment type",
      impact,
      detail: "Dialysis appointment — patients rarely no-show for life-critical treatment",
    });
  } else if (trip.tripType === "recurring") {
    const impact = -5;
    probability += impact;
    factors.push({
      name: "Appointment type",
      impact,
      detail: "Recurring trip — established routine reduces no-show risk",
    });
  }

  // ── Factor 5: Days since last trip ──
  const lastTrip = await db
    .select({ scheduledDate: trips.scheduledDate })
    .from(trips)
    .where(
      and(
        eq(trips.patientId, trip.patientId),
        sql`${trips.scheduledDate} < ${trip.scheduledDate}`,
        eq(trips.status, "COMPLETED"),
        isNull(trips.deletedAt),
      ),
    )
    .orderBy(desc(trips.scheduledDate))
    .limit(1);

  if (lastTrip.length > 0) {
    const lastDate = new Date(lastTrip[0].scheduledDate + "T12:00:00Z");
    const tripDate = new Date(trip.scheduledDate + "T12:00:00Z");
    const daysSinceLast = Math.round((tripDate.getTime() - lastDate.getTime()) / 86400000);

    if (daysSinceLast > 30) {
      const impact = Math.min(10, Math.round((daysSinceLast - 30) / 10));
      probability += impact;
      factors.push({
        name: "Days since last trip",
        impact,
        detail: `${daysSinceLast} days since last completed trip — gap increases risk`,
      });
    } else if (daysSinceLast <= 7) {
      const impact = -3;
      probability += impact;
      factors.push({
        name: "Days since last trip",
        impact,
        detail: `${daysSinceLast} days since last trip — recent active patient`,
      });
    }
  }

  // ── Factor 6: Distance from home ──
  if (trip.pickupLat && trip.pickupLng) {
    const [patient] = await db
      .select({ lat: patients.lat, lng: patients.lng })
      .from(patients)
      .where(eq(patients.id, trip.patientId))
      .limit(1);

    if (patient?.lat && patient?.lng) {
      const distance = haversineMiles(patient.lat, patient.lng, trip.pickupLat, trip.pickupLng);
      if (distance > 30) {
        const impact = Math.min(8, Math.round((distance - 30) / 10));
        probability += impact;
        factors.push({
          name: "Distance from home",
          impact,
          detail: `Pickup is ${Math.round(distance)} miles from patient's home — longer distance increases risk`,
        });
      }
    }
  }

  // ── Factor 7: Confirmation status ──
  if (trip.confirmationStatus === "unconfirmed" || !trip.confirmationStatus) {
    const impact = 15;
    probability += impact;
    factors.push({
      name: "Trip confirmation",
      impact,
      detail: "Trip is unconfirmed — major risk factor",
    });
  } else if (trip.confirmationStatus === "confirmed") {
    const impact = -10;
    probability += impact;
    factors.push({
      name: "Trip confirmation",
      impact,
      detail: "Trip is confirmed — significantly reduces no-show risk",
    });
  }

  // ── Factor 8: Recent cancellation/no-show streak ──
  const recentTrips = await db
    .select({ status: trips.status })
    .from(trips)
    .where(
      and(
        eq(trips.patientId, trip.patientId),
        sql`${trips.scheduledDate} < ${trip.scheduledDate}`,
        isNull(trips.deletedAt),
        sql`${trips.status} IN ('COMPLETED', 'NO_SHOW', 'CANCELLED')`,
      ),
    )
    .orderBy(desc(trips.scheduledDate))
    .limit(3);

  if (recentTrips.length >= 2) {
    const recentNoShows = recentTrips.filter((t) => t.status === "NO_SHOW").length;
    if (recentNoShows >= 2) {
      const impact = 15;
      probability += impact;
      factors.push({
        name: "Recent no-show streak",
        impact,
        detail: `Patient no-showed ${recentNoShows} of last ${recentTrips.length} trips — high-risk pattern`,
      });
    }
  }

  // ── Factor 9: Seasonal/environmental risk ──
  if (trip.scheduledDate) {
    const envMultiplier = computeEnvironmentalMultiplier(trip.scheduledDate);
    if (envMultiplier !== 1.0) {
      const weatherImpact = Math.round((envMultiplier - 1.0) * 20);
      if (weatherImpact !== 0) {
        probability += weatherImpact;
        const date = new Date(trip.scheduledDate + "T12:00:00Z");
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        factors.push({
          name: "Seasonal conditions",
          impact: weatherImpact,
          detail: `${monthNames[date.getMonth()]} seasonal risk multiplier: ${envMultiplier}x`,
        });
      }
    }
  }

  // Clamp probability
  probability = Math.max(0, Math.min(100, Math.round(probability)));

  // Determine risk level
  let riskLevel: NoShowPrediction["riskLevel"];
  if (probability >= 70) riskLevel = "critical";
  else if (probability >= 50) riskLevel = "high";
  else if (probability >= 30) riskLevel = "medium";
  else riskLevel = "low";

  // Determine recommended action
  let recommendedAction: string;
  if (probability >= 70) {
    recommendedAction =
      "Auto-call patient 2h before + send driver confirmation SMS";
  } else if (probability >= 50) {
    recommendedAction = "Send confirmation SMS to patient";
  } else if (probability >= 30) {
    recommendedAction = "Monitor — consider sending reminder notification";
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

// ─── Batch Prediction ───────────────────────────────────────────────────────

export async function batchPredictNoShows(
  date: string,
  companyId: number,
): Promise<NoShowPrediction[]> {
  // Get all upcoming trips for the date
  const upcomingTrips = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.scheduledDate, date),
        isNull(trips.deletedAt),
        sql`${trips.status} NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')`,
      ),
    );

  const predictions: NoShowPrediction[] = [];

  for (const trip of upcomingTrips) {
    try {
      const prediction = await predictNoShow(trip.id);
      predictions.push(prediction);
    } catch (err: any) {
      console.warn(`[NO-SHOW-PREDICT] Failed for trip ${trip.id}: ${err.message}`);
    }
  }

  // Sort by probability descending (highest risk first)
  predictions.sort((a, b) => b.probability - a.probability);

  return predictions;
}
