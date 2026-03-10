import { db } from "../db";
import { trips, drivers, deadMileDailySummary } from "@shared/schema";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";

/**
 * Haversine distance in meters between two lat/lng points.
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

interface TripForOptimization {
  id: number;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  pickupTime: string | null;
  routeOrder: number | null;
  publicId: string;
}

/**
 * Get a driver's assigned trips for a given date (SCHEDULED/ASSIGNED status).
 */
async function getDriverAssignedTrips(driverId: number, date: string): Promise<TripForOptimization[]> {
  const rows = await db
    .select({
      id: trips.id,
      publicId: trips.publicId,
      pickupLat: trips.pickupLat,
      pickupLng: trips.pickupLng,
      dropoffLat: trips.dropoffLat,
      dropoffLng: trips.dropoffLng,
      pickupTime: trips.pickupTime,
      routeOrder: trips.routeOrder,
    })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.scheduledDate, date),
        inArray(trips.status, ["SCHEDULED", "ASSIGNED"]),
        isNull(trips.deletedAt),
      )
    )
    .orderBy(trips.pickupTime);

  // Filter to trips with valid coordinates
  return rows.filter(
    (t) =>
      t.pickupLat != null && t.pickupLng != null &&
      t.dropoffLat != null && t.dropoffLng != null
  ) as TripForOptimization[];
}

/**
 * Calculate total dead miles (inter-trip distance) for a given ordering.
 * Dead miles = sum of distances from each trip's dropoff to the next trip's pickup.
 */
function calculateTotalDeadMiles(
  orderedTrips: TripForOptimization[],
  startLat?: number | null,
  startLng?: number | null,
): number {
  if (orderedTrips.length === 0) return 0;

  let totalMeters = 0;

  // Distance from start (driver base) to first pickup
  if (startLat != null && startLng != null) {
    totalMeters += haversineDistance(startLat, startLng, orderedTrips[0].pickupLat, orderedTrips[0].pickupLng);
  }

  // Distance between consecutive trips
  for (let i = 0; i < orderedTrips.length - 1; i++) {
    const current = orderedTrips[i];
    const next = orderedTrips[i + 1];
    totalMeters += haversineDistance(
      current.dropoffLat, current.dropoffLng,
      next.pickupLat, next.pickupLng,
    );
  }

  return totalMeters;
}

/**
 * Nearest-neighbor heuristic: start from the driver's location (or first trip),
 * and greedily pick the closest unvisited trip's pickup from the current dropoff.
 */
function nearestNeighborOrder(
  tripsToOrder: TripForOptimization[],
  startLat?: number | null,
  startLng?: number | null,
): TripForOptimization[] {
  if (tripsToOrder.length <= 1) return [...tripsToOrder];

  const remaining = [...tripsToOrder];
  const ordered: TripForOptimization[] = [];

  // Start from driver base or just pick closest to first trip
  let currentLat = startLat ?? remaining[0].pickupLat;
  let currentLng = startLng ?? remaining[0].pickupLng;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistance(currentLat, currentLng, remaining[i].pickupLat, remaining[i].pickupLng);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    ordered.push(chosen);
    currentLat = chosen.dropoffLat;
    currentLng = chosen.dropoffLng;
  }

  return ordered;
}

/**
 * 2-opt local search improvement on top of nearest-neighbor.
 * Tries swapping pairs of edges to reduce total dead miles.
 */
function twoOptImprove(
  orderedTrips: TripForOptimization[],
  startLat?: number | null,
  startLng?: number | null,
): TripForOptimization[] {
  if (orderedTrips.length <= 2) return orderedTrips;

  let best = [...orderedTrips];
  let bestCost = calculateTotalDeadMiles(best, startLat, startLng);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [...best];
        // Reverse the segment between i and j
        const segment = candidate.splice(i, j - i + 1);
        segment.reverse();
        candidate.splice(i, 0, ...segment);

        const candidateCost = calculateTotalDeadMiles(candidate, startLat, startLng);
        if (candidateCost < bestCost - 1) { // at least 1m improvement
          best = candidate;
          bestCost = candidateCost;
          improved = true;
        }
      }
    }
  }

  return best;
}

export interface ReorderSuggestion {
  driverId: number;
  date: string;
  currentOrder: Array<{ tripId: number; publicId: string; position: number }>;
  suggestedOrder: Array<{ tripId: number; publicId: string; position: number }>;
  currentDeadMiles: number;
  suggestedDeadMiles: number;
  savingsMiles: number;
  savingsPercent: number;
  estimatedTimeSavedMinutes: number;
}

/**
 * Suggest optimal trip ordering for a driver on a given date.
 */
export async function suggestOptimalOrder(driverId: number, date: string): Promise<ReorderSuggestion | null> {
  const driverTrips = await getDriverAssignedTrips(driverId, date);
  if (driverTrips.length < 2) return null;

  const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
  if (!driver) return null;

  const startLat = driver.lastLat;
  const startLng = driver.lastLng;

  // Current order (by pickup time / route order)
  const currentOrder = [...driverTrips];

  // Apply nearest-neighbor + 2-opt
  const nnOrder = nearestNeighborOrder(driverTrips, startLat, startLng);
  const optimizedOrder = twoOptImprove(nnOrder, startLat, startLng);

  const currentDeadMeters = calculateTotalDeadMiles(currentOrder, startLat, startLng);
  const suggestedDeadMeters = calculateTotalDeadMiles(optimizedOrder, startLat, startLng);

  const currentDeadMiles = metersToMiles(currentDeadMeters);
  const suggestedDeadMiles = metersToMiles(suggestedDeadMeters);
  const savingsMiles = currentDeadMiles - suggestedDeadMiles;
  const savingsPercent = currentDeadMiles > 0 ? (savingsMiles / currentDeadMiles) * 100 : 0;

  // Estimate time saved (avg 30mph)
  const savedMeters = currentDeadMeters - suggestedDeadMeters;
  const estimatedTimeSavedMinutes = Math.round(savedMeters / 13.41 / 60);

  return {
    driverId,
    date,
    currentOrder: currentOrder.map((t, i) => ({ tripId: t.id, publicId: t.publicId, position: i + 1 })),
    suggestedOrder: optimizedOrder.map((t, i) => ({ tripId: t.id, publicId: t.publicId, position: i + 1 })),
    currentDeadMiles: Number(currentDeadMiles.toFixed(2)),
    suggestedDeadMiles: Number(suggestedDeadMiles.toFixed(2)),
    savingsMiles: Number(savingsMiles.toFixed(2)),
    savingsPercent: Number(savingsPercent.toFixed(1)),
    estimatedTimeSavedMinutes: Math.max(0, estimatedTimeSavedMinutes),
  };
}

/**
 * Calculate savings between a current order and a suggested order.
 */
export function calculateSavings(
  currentTrips: TripForOptimization[],
  suggestedTrips: TripForOptimization[],
  startLat?: number | null,
  startLng?: number | null,
) {
  const currentDeadMeters = calculateTotalDeadMiles(currentTrips, startLat, startLng);
  const suggestedDeadMeters = calculateTotalDeadMiles(suggestedTrips, startLat, startLng);

  return {
    currentDeadMiles: Number(metersToMiles(currentDeadMeters).toFixed(2)),
    suggestedDeadMiles: Number(metersToMiles(suggestedDeadMeters).toFixed(2)),
    savingsMiles: Number(metersToMiles(currentDeadMeters - suggestedDeadMeters).toFixed(2)),
    savingsPercent: currentDeadMeters > 0
      ? Number(((1 - suggestedDeadMeters / currentDeadMeters) * 100).toFixed(1))
      : 0,
  };
}

/**
 * Apply reordering: update routeOrder on trips for a driver/date.
 */
export async function applyReorder(
  driverId: number,
  date: string,
  newOrder: Array<{ tripId: number; position: number }>,
): Promise<number> {
  let updated = 0;
  for (const item of newOrder) {
    await db.update(trips).set({
      routeOrder: item.position,
      updatedAt: new Date(),
    }).where(
      and(
        eq(trips.id, item.tripId),
        eq(trips.driverId, driverId),
        eq(trips.scheduledDate, date),
      )
    );
    updated++;
  }

  console.log(`[ROUTE-OPT] Applied reorder for driver ${driverId} date ${date}: ${updated} trips reordered`);
  return updated;
}

/**
 * Batch optimize: generate suggestions for all drivers with assigned trips on a date.
 */
export async function batchOptimize(companyId: number, date: string): Promise<{
  suggestions: ReorderSuggestion[];
  totalSavingsMiles: number;
  totalTimeSavedMinutes: number;
}> {
  // Get all drivers in the company with assigned trips on the date
  const driverIds = await db
    .select({ driverId: trips.driverId })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.scheduledDate, date),
        inArray(trips.status, ["SCHEDULED", "ASSIGNED"]),
        isNull(trips.deletedAt),
        sql`${trips.driverId} IS NOT NULL`,
      )
    )
    .groupBy(trips.driverId);

  const suggestions: ReorderSuggestion[] = [];
  let totalSavingsMiles = 0;
  let totalTimeSavedMinutes = 0;

  for (const row of driverIds) {
    if (!row.driverId) continue;
    try {
      const suggestion = await suggestOptimalOrder(row.driverId, date);
      if (suggestion && suggestion.savingsMiles > 0.1) { // Only include meaningful savings
        suggestions.push(suggestion);
        totalSavingsMiles += suggestion.savingsMiles;
        totalTimeSavedMinutes += suggestion.estimatedTimeSavedMinutes;
      }
    } catch (err: any) {
      console.warn(`[ROUTE-OPT] Failed to optimize driver ${row.driverId}: ${err.message}`);
    }
  }

  console.log(`[ROUTE-OPT] Company ${companyId} date ${date}: ${suggestions.length} suggestions, ${totalSavingsMiles.toFixed(1)} miles saveable`);

  return {
    suggestions,
    totalSavingsMiles: Number(totalSavingsMiles.toFixed(2)),
    totalTimeSavedMinutes,
  };
}

/**
 * Generate a savings report for a company: how much could be saved if all suggestions were applied.
 */
export async function getSavingsReport(companyId: number, date: string) {
  const result = await batchOptimize(companyId, date);

  // Get existing dead mile data if available
  const existingSummaries = await db
    .select()
    .from(deadMileDailySummary)
    .where(
      and(
        eq(deadMileDailySummary.companyId, companyId),
        eq(deadMileDailySummary.summaryDate, date),
      )
    );

  const historicalDeadMiles = existingSummaries.reduce((sum, s) => sum + Number(s.totalDeadMiles), 0);
  const historicalPaidMiles = existingSummaries.reduce((sum, s) => sum + Number(s.totalPaidMiles), 0);

  return {
    companyId,
    date,
    suggestions: result.suggestions,
    totalSavingsMiles: result.totalSavingsMiles,
    totalTimeSavedMinutes: result.totalTimeSavedMinutes,
    driversWithSuggestions: result.suggestions.length,
    historical: {
      deadMiles: Number(historicalDeadMiles.toFixed(2)),
      paidMiles: Number(historicalPaidMiles.toFixed(2)),
      deadMileRatio: (historicalPaidMiles + historicalDeadMiles) > 0
        ? Number((historicalDeadMiles / (historicalPaidMiles + historicalDeadMiles)).toFixed(4))
        : 0,
    },
  };
}
