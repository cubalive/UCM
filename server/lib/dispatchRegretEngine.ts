/**
 * Dispatch Regret Minimization Engine
 *
 * Prevents suboptimal assignments by looking ahead at upcoming trips.
 * Instead of greedily assigning the best driver to the current trip,
 * simulates multiple scenarios to find the assignment that maximizes
 * total day outcome across all pending trips.
 *
 * Example: Don't assign your best WAV driver to a short ambulatory trip
 * when a wheelchair trip is arriving in 20 minutes.
 */

import { db } from "../db";
import { trips, drivers, companies, isVehicleCompatible } from "@shared/schema";
import { eq, and, gte, lte, isNull, sql, ne, inArray } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AlternativeScenario {
  driverId: number;
  driverName: string;
  immediateScore: number;
  futureImpactScore: number;
  totalDayScore: number;
}

interface SimulationResult {
  bestDriver: number;
  bestDriverName: string;
  reason: string;
  alternativeScenarios: AlternativeScenario[];
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

function timeToMinutes(time: string): number {
  const parts = time.split(":");
  return parseInt(parts[0]) * 60 + parseInt(parts[1] || "0");
}

/**
 * Score how well a driver can serve a trip (0-100).
 * Based on proximity and vehicle compatibility — a lightweight version
 * of the full scoring to allow fast simulation of many scenarios.
 */
function quickScore(
  driver: { id: number; lastLat: number | null; lastLng: number | null; vehicleCapability: string },
  trip: { pickupLat: string | null; pickupLng: string | null; mobilityRequirement: string },
  maxDistanceMeters: number
): number {
  // Hard fail: incompatible vehicle
  if (!isVehicleCompatible(trip.mobilityRequirement, driver.vehicleCapability)) {
    return 0;
  }

  // Proximity score
  let proximityScore = 30; // default if no GPS
  if (driver.lastLat && driver.lastLng && trip.pickupLat && trip.pickupLng) {
    const dist = haversineMeters(
      driver.lastLat, driver.lastLng,
      Number(trip.pickupLat), Number(trip.pickupLng)
    );
    proximityScore = Math.max(0, Math.min(100, 100 - (dist / maxDistanceMeters) * 100));
  }

  // Vehicle match bonus
  let vehicleBonus = 0;
  if (trip.mobilityRequirement === "WHEELCHAIR" && driver.vehicleCapability === "WHEELCHAIR") {
    vehicleBonus = 20;
  } else if (trip.mobilityRequirement === "STRETCHER" && driver.vehicleCapability === "STRETCHER") {
    vehicleBonus = 20;
  } else if (["AMBULATORY", "STANDARD"].includes(trip.mobilityRequirement)) {
    vehicleBonus = 10;
  }

  return Math.min(100, proximityScore + vehicleBonus);
}

// ─── Main Simulation Function ─────────────────────────────────────────────────

export async function simulateAssignment(
  tripId: number,
  candidateDriverIds: number[],
  lookaheadMinutes: number = 60
): Promise<SimulationResult> {
  // Fetch the target trip
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  if (!trip) throw new Error(`Trip ${tripId} not found`);

  // Get company config for max distance
  const [company] = await db.select().from(companies).where(eq(companies.id, trip.companyId)).limit(1);
  const maxDistanceMeters = company?.autoAssignMaxDistanceMeters || 30000;

  // Fetch candidate drivers
  const candidateDrivers = candidateDriverIds.length > 0
    ? await db.select().from(drivers).where(
        and(
          inArray(drivers.id, candidateDriverIds),
          isNull(drivers.deletedAt)
        )
      )
    : await db.select().from(drivers).where(
        and(
          eq(drivers.companyId, trip.companyId),
          eq(drivers.cityId, trip.cityId),
          eq(drivers.active, true),
          ne(drivers.dispatchStatus, "off"),
          isNull(drivers.deletedAt)
        )
      );

  if (candidateDrivers.length === 0) {
    return {
      bestDriver: 0,
      bestDriverName: "",
      reason: "No candidate drivers available",
      alternativeScenarios: [],
    };
  }

  // Fetch upcoming unassigned trips in the lookahead window
  const tripPickupMinutes = trip.pickupTime ? timeToMinutes(trip.pickupTime) : 0;
  const lookaheadEnd = tripPickupMinutes + lookaheadMinutes;

  const upcomingTrips = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.companyId, trip.companyId),
        eq(trips.cityId, trip.cityId),
        eq(trips.scheduledDate, trip.scheduledDate),
        isNull(trips.driverId),
        isNull(trips.deletedAt),
        inArray(trips.status, ["SCHEDULED", "PENDING"]),
        sql`${trips.id} != ${tripId}`
      )
    )
    .limit(30); // limit to prevent excessive computation

  // Filter to trips within the lookahead window
  const lookaheadTrips = upcomingTrips.filter(t => {
    if (!t.pickupTime) return false;
    const mins = timeToMinutes(t.pickupTime);
    return mins >= tripPickupMinutes && mins <= lookaheadEnd;
  });

  // For each candidate driver, simulate: assign them to the current trip,
  // then see how well remaining drivers handle upcoming trips
  const scenarios: AlternativeScenario[] = [];

  for (const candidateDriver of candidateDrivers) {
    // Score this driver on the current trip
    const immediateScore = quickScore(
      candidateDriver,
      { pickupLat: trip.pickupLat, pickupLng: trip.pickupLng, mobilityRequirement: trip.mobilityRequirement },
      maxDistanceMeters
    );

    // Simulate: if this driver is taken, how well do remaining drivers cover upcoming trips?
    const remainingDrivers = candidateDrivers.filter(d => d.id !== candidateDriver.id);

    let futureImpactScore = 100; // perfect by default if no upcoming trips

    if (lookaheadTrips.length > 0 && remainingDrivers.length > 0) {
      // For each upcoming trip, find the best remaining driver and score it
      let totalFutureScore = 0;
      let futureTripsScored = 0;

      for (const futureTrip of lookaheadTrips) {
        let bestFutureScore = 0;

        for (const remainingDriver of remainingDrivers) {
          const score = quickScore(
            remainingDriver,
            { pickupLat: futureTrip.pickupLat, pickupLng: futureTrip.pickupLng, mobilityRequirement: futureTrip.mobilityRequirement },
            maxDistanceMeters
          );
          if (score > bestFutureScore) {
            bestFutureScore = score;
          }
        }

        totalFutureScore += bestFutureScore;
        futureTripsScored++;
      }

      futureImpactScore = futureTripsScored > 0
        ? Math.round(totalFutureScore / futureTripsScored)
        : 100;
    } else if (lookaheadTrips.length > 0 && remainingDrivers.length === 0) {
      // No remaining drivers — future impact is zero (all future trips uncovered)
      futureImpactScore = 0;
    }

    // Total day score: weighted combination of immediate and future
    // Immediate matters more for urgent trips, future matters more for planning
    const immediateWeight = 0.6;
    const futureWeight = 0.4;
    const totalDayScore = Math.round(
      immediateScore * immediateWeight + futureImpactScore * futureWeight
    );

    scenarios.push({
      driverId: candidateDriver.id,
      driverName: `${candidateDriver.firstName} ${candidateDriver.lastName}`,
      immediateScore,
      futureImpactScore,
      totalDayScore,
    });
  }

  // Sort by total day score descending
  scenarios.sort((a, b) => b.totalDayScore - a.totalDayScore);

  const best = scenarios[0];
  const greedyBest = [...scenarios].sort((a, b) => b.immediateScore - a.immediateScore)[0];

  // Build explanation
  let reason: string;
  if (best.driverId === greedyBest.driverId) {
    reason = `${best.driverName} is the best choice both immediately (score: ${best.immediateScore}) and for the day (total: ${best.totalDayScore})`;
  } else {
    reason = `${best.driverName} chosen over ${greedyBest.driverName} to optimize the full day. ` +
      `${greedyBest.driverName} scores higher immediately (${greedyBest.immediateScore} vs ${best.immediateScore}) ` +
      `but assigning them here would leave ${lookaheadTrips.length} upcoming trip(s) with worse coverage ` +
      `(future impact: ${best.futureImpactScore} vs ${greedyBest.futureImpactScore})`;
  }

  return {
    bestDriver: best.driverId,
    bestDriverName: best.driverName,
    reason,
    alternativeScenarios: scenarios,
  };
}
