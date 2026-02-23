import { db } from "../db";
import { trips, cities, drivers, companies } from "@shared/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

const DEFAULT_SERVICE_BUFFER_MIN = 10;
const DEFAULT_GAP_MINUTES = 15;
const BUFFER_BY_MOBILITY: Record<string, number> = {
  WHEELCHAIR: 15,
  wheelchair: 15,
  STRETCHER: 20,
  stretcher: 20,
};

function localToUtc(scheduledDate: string, timeStr: string, timezone: string): Date | null {
  try {
    const [year, month, day] = scheduledDate.split("-").map(Number);
    const timeParts = timeStr.split(":");
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);
    const second = timeParts.length > 2 ? parseInt(timeParts[2], 10) : 0;
    const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric", hour12: false,
    }).formatToParts(probe);
    const get = (type: string) => {
      const p = parts.find(p => p.type === type);
      return p ? parseInt(p.value, 10) : 0;
    };
    const probeLocalHour = get("hour") === 24 ? 0 : get("hour");
    const probeLocalMs = (probeLocalHour * 3600 + get("minute") * 60 + get("second")) * 1000;
    const offsetMs = (12 * 3600 * 1000) - probeLocalMs;
    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) + offsetMs;
    const result = new Date(utcMs);
    if (isNaN(result.getTime())) return null;
    const verify = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hour: "numeric", minute: "numeric", hour12: false,
    }).formatToParts(result);
    const vHour = parseInt(verify.find(p => p.type === "hour")?.value || "0", 10);
    if (vHour !== hour && Math.abs((vHour === 24 ? 0 : vHour) - hour) === 1) {
      return new Date(utcMs + (hour > vHour ? -3600000 : 3600000));
    }
    return result;
  } catch {
    return null;
  }
}

function parseTripDateTime(scheduledDate: string, scheduledTime: string | null, pickupTime: string | null, timezone: string): Date | null {
  const timeStr = pickupTime || scheduledTime;
  if (!timeStr) return null;
  return localToUtc(scheduledDate, timeStr, timezone);
}

function estimatedFinishAt(trip: any, timezone: string): Date | null {
  const pickupDt = parseTripDateTime(trip.scheduledDate, trip.scheduledTime, trip.pickupTime, timezone);
  if (!pickupDt) return null;

  let tripDurationMin = 30;
  if (trip.etaPickupToDropoffMin) {
    tripDurationMin = trip.etaPickupToDropoffMin;
  } else if (trip.routeDurationSeconds) {
    tripDurationMin = Math.ceil(trip.routeDurationSeconds / 60);
  } else if (trip.durationMinutes) {
    tripDurationMin = trip.durationMinutes;
  }

  const bufferMin = BUFFER_BY_MOBILITY[trip.mobilityRequirement] || DEFAULT_SERVICE_BUFFER_MIN;
  return new Date(pickupDt.getTime() + (tripDurationMin + bufferMin) * 60_000);
}

export interface FeasibilityResult {
  feasible: boolean;
  reason?: string;
  conflictingTripId?: number;
  conflictingTripPublicId?: string;
}

export async function checkTripFeasibility(
  driverId: number,
  candidateTrip: { id: number; cityId: number; scheduledDate: string; scheduledTime: string | null; pickupTime: string | null; mobilityRequirement: string; etaPickupToDropoffMin?: number | null; routeDurationSeconds?: number | null; durationMinutes?: number | null; dispatchAt?: Date | null },
): Promise<FeasibilityResult> {
  let timezone = "America/New_York";
  try {
    const cityRows = await db.select({ timezone: cities.timezone }).from(cities).where(eq(cities.id, candidateTrip.cityId)).limit(1);
    if (cityRows.length > 0) timezone = cityRows[0].timezone;
  } catch {}

  const candidatePickupDt = parseTripDateTime(candidateTrip.scheduledDate, candidateTrip.scheduledTime, candidateTrip.pickupTime, timezone);
  if (!candidatePickupDt) {
    return { feasible: true };
  }

  let gapMinutes = DEFAULT_GAP_MINUTES;
  try {
    const [driverRow] = await db.select({ companyId: drivers.companyId }).from(drivers).where(eq(drivers.id, driverId)).limit(1);
    if (driverRow) {
      const [companyRow] = await db.select({ minGapMinutes: companies.minGapMinutes }).from(companies).where(eq(companies.id, driverRow.companyId)).limit(1);
      if (companyRow?.minGapMinutes != null) gapMinutes = companyRow.minGapMinutes;
    }
  } catch {}

  const sameDate = candidateTrip.scheduledDate;
  const existingTrips = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.scheduledDate, sameDate),
        inArray(trips.status, ["SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "IN_PROGRESS", "ARRIVED_DROPOFF"]),
        isNull(trips.deletedAt),
      )
    );

  if (existingTrips.length === 0) return { feasible: true };

  const bufferMinCandidate = Math.max(BUFFER_BY_MOBILITY[candidateTrip.mobilityRequirement] || DEFAULT_SERVICE_BUFFER_MIN, gapMinutes);
  let candidateDurationMin = 30;
  if (candidateTrip.etaPickupToDropoffMin) {
    candidateDurationMin = candidateTrip.etaPickupToDropoffMin;
  } else if (candidateTrip.routeDurationSeconds) {
    candidateDurationMin = Math.ceil(candidateTrip.routeDurationSeconds / 60);
  } else if (candidateTrip.durationMinutes) {
    candidateDurationMin = candidateTrip.durationMinutes;
  }
  const candidateFinishAt = new Date(candidatePickupDt.getTime() + (candidateDurationMin + bufferMinCandidate) * 60_000);

  const candidateDispatchAt = candidateTrip.dispatchAt || candidatePickupDt;

  for (const existing of existingTrips) {
    if (existing.id === candidateTrip.id) continue;

    const existingPickupDt = parseTripDateTime(existing.scheduledDate, existing.scheduledTime, existing.pickupTime, timezone);
    if (!existingPickupDt) continue;

    const existingFinishRaw = estimatedFinishAt(existing, timezone);
    if (!existingFinishRaw) continue;

    const existingFinish = new Date(existingFinishRaw.getTime() + gapMinutes * 60_000);

    const existingDispatchAt = existing.dispatchAt ? new Date(existing.dispatchAt) : existingPickupDt;

    const candidateStartsBeforeExistingEnds = candidateDispatchAt <= existingFinish;
    const existingStartsBeforeCandidateEnds = existingDispatchAt <= candidateFinishAt;

    if (candidateStartsBeforeExistingEnds && existingStartsBeforeCandidateEnds) {
      return {
        feasible: false,
        reason: `Trip conflicts with another assignment (insufficient time between trips)`,
        conflictingTripId: existing.id,
        conflictingTripPublicId: existing.publicId,
      };
    }
  }

  return { feasible: true };
}
