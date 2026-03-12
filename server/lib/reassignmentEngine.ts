import { db } from "../db";
import { trips, companies, automationEvents } from "@shared/schema";
import { eq } from "drizzle-orm";
import { scoreDriversForTrip } from "./autoAssignV2Engine";
import { broadcastCompanyTripUpdate } from "./tripTransitionHelper";
import { storage } from "../storage";

const MAX_SUGGESTIONS = 3;

interface ReassignmentSuggestion {
  driverId: number;
  driverName: string;
  distanceMeters: number;
  finalScore: number;
  rank: number;
}

interface ReassignmentResult {
  tripId: number;
  suggestions: ReassignmentSuggestion[];
  autoReassigned: boolean;
  assignedDriverId?: number;
}

/**
 * When a trip loses its driver (cancellation, no-show, driver offline),
 * score available drivers and suggest the best alternatives to dispatch.
 */
export async function suggestReassignment(tripId: number): Promise<ReassignmentResult> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) {
    console.warn(`[REASSIGN] Trip ${tripId} not found`);
    return { tripId, suggestions: [], autoReassigned: false };
  }

  // Get company config for scoring weights
  const [company] = await db.select().from(companies).where(eq(companies.id, trip.companyId));
  if (!company) {
    console.warn(`[REASSIGN] Company ${trip.companyId} not found for trip ${tripId}`);
    return { tripId, suggestions: [], autoReassigned: false };
  }

  const config = {
    offerTimeoutSeconds: company.autoAssignOfferTimeoutSeconds,
    maxRounds: company.autoAssignMaxRounds,
    maxDistanceMeters: company.autoAssignMaxDistanceMeters,
    weightDistance: company.autoAssignWeightDistance,
    weightReliability: company.autoAssignWeightReliability,
    weightLoad: company.autoAssignWeightLoad,
    weightFatigue: company.autoAssignWeightFatigue,
  };

  // Score all available drivers for this trip
  const scored = await scoreDriversForTrip(tripId, config);

  // Filter to eligible drivers and exclude the original driver
  const eligible = scored
    .filter(c => c.eligible && c.driverId !== trip.driverId)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, MAX_SUGGESTIONS);

  if (eligible.length === 0) {
    console.log(`[REASSIGN] No eligible drivers found for trip ${tripId}`);
    return { tripId, suggestions: [], autoReassigned: false };
  }

  const suggestions: ReassignmentSuggestion[] = eligible.map((c, i) => ({
    driverId: c.driverId,
    driverName: c.driverName,
    distanceMeters: c.distanceMeters,
    finalScore: c.finalScore,
    rank: i + 1,
  }));

  // Store event in automationEvents
  try {
    await db.insert(automationEvents).values({
      eventType: "REASSIGNMENT_SUGGESTED",
      tripId,
      companyId: trip.companyId,
      driverId: trip.driverId, // the original driver who was removed
      payload: {
        previousDriverId: trip.driverId,
        previousStatus: trip.status,
        candidates: suggestions,
        suggestedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error(`[REASSIGN] Failed to store automation event for trip ${tripId}:`, err.message);
  }

  // Broadcast to company channel so dispatch UI gets the suggestion
  broadcastCompanyTripUpdate(trip.companyId, {
    tripId,
    type: "REASSIGNMENT_SUGGESTED",
    publicId: trip.publicId,
    previousDriverId: trip.driverId,
    candidates: suggestions,
  });

  console.log(`[REASSIGN] Suggested ${suggestions.length} candidates for trip ${tripId}: ${suggestions.map(s => `${s.driverName}(${s.finalScore.toFixed(2)})`).join(", ")}`);

  return { tripId, suggestions, autoReassigned: false };
}

/**
 * If the company has auto-assign enabled, automatically reassign the trip
 * to the top-scoring candidate. Otherwise just return suggestions.
 */
export async function autoReassignIfConfigured(tripId: number): Promise<ReassignmentResult> {
  const result = await suggestReassignment(tripId);

  if (result.suggestions.length === 0) {
    return result;
  }

  // Check if company has auto-assign enabled
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) return result;

  const [company] = await db.select().from(companies).where(eq(companies.id, trip.companyId));
  if (!company?.autoAssignV2Enabled) {
    return result;
  }

  const topCandidate = result.suggestions[0];

  try {
    // Reset trip status to ASSIGNED with the new driver
    // Only reassign if the trip is still in a reassignable state
    const reassignableStatuses = ["SCHEDULED", "DISPATCHED", "CANCELLED"];
    if (!reassignableStatuses.includes(trip.status)) {
      console.log(`[REASSIGN] Trip ${tripId} status ${trip.status} is not reassignable`);
      return result;
    }

    // Get the driver to find their vehicle
    const driver = await storage.getDriver(topCandidate.driverId);
    if (!driver) {
      console.warn(`[REASSIGN] Top candidate driver ${topCandidate.driverId} not found`);
      return result;
    }

    await db.update(trips).set({
      driverId: topCandidate.driverId,
      vehicleId: driver.vehicleId,
      status: "ASSIGNED",
    }).where(eq(trips.id, tripId));

    // Log the auto-reassignment
    await db.insert(automationEvents).values({
      eventType: "REASSIGNMENT_AUTO_ASSIGNED",
      tripId,
      companyId: trip.companyId,
      driverId: topCandidate.driverId,
      payload: {
        previousDriverId: trip.driverId,
        newDriverId: topCandidate.driverId,
        newDriverName: topCandidate.driverName,
        score: topCandidate.finalScore,
        autoAssigned: true,
        assignedAt: new Date().toISOString(),
      },
    });

    broadcastCompanyTripUpdate(trip.companyId, {
      tripId,
      type: "REASSIGNMENT_AUTO_ASSIGNED",
      publicId: trip.publicId,
      previousDriverId: trip.driverId,
      newDriverId: topCandidate.driverId,
      newDriverName: topCandidate.driverName,
      status: "ASSIGNED",
    });

    console.log(`[REASSIGN] Auto-reassigned trip ${tripId} to driver ${topCandidate.driverName} (id=${topCandidate.driverId}, score=${topCandidate.finalScore.toFixed(2)})`);

    return {
      ...result,
      autoReassigned: true,
      assignedDriverId: topCandidate.driverId,
    };
  } catch (err: any) {
    console.error(`[REASSIGN] Auto-reassignment failed for trip ${tripId}:`, err.message);
    return result;
  }
}
