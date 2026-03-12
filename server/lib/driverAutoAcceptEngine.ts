/**
 * Driver Auto-Accept Engine
 *
 * Automatically transitions trips from ASSIGNED -> EN_ROUTE_TO_PICKUP
 * for high-rated drivers, skipping manual driver confirmation.
 *
 * Eligibility criteria:
 *  - Company has auto-assign V2 enabled (proxy for auto-accept enabled)
 *  - Driver reliability score (on-time rate over last 30 days) >= 0.90
 *  - Driver completion rate over last 30 days >= 95%
 */

import { db } from "../db";
import { trips, drivers, companies, automationEvents } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { transitionTripStatus } from "./tripTransitionHelper";
import { sendPushToDriver } from "./push";

const AUTO_ACCEPT_RELIABILITY_THRESHOLD = 0.90;
const AUTO_ACCEPT_COMPLETION_RATE_THRESHOLD = 0.95;
const LOOKBACK_DAYS = 30;

interface DriverStats {
  completedCount: number;
  missedCount: number;
  cancelledByDriverCount: number;
  totalTrips: number;
  reliabilityScore: number;
  completionRate: number;
}

/**
 * Compute driver reliability and completion stats over the last 30 days.
 * - reliabilityScore: completed / (completed + no_show + cancelled) — same as getDriverOnTimeRate
 * - completionRate: completed / (completed + no_show) — excludes external cancellations
 */
async function getDriverStats(driverId: number): Promise<DriverStats> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
      COUNT(*) FILTER (WHERE status = 'NO_SHOW') as no_show,
      COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled
    FROM trips
    WHERE driver_id = ${driverId}
    AND scheduled_date >= (CURRENT_DATE - INTERVAL '30 days')::text
    AND status IN ('COMPLETED', 'NO_SHOW', 'CANCELLED')
  `);
  const row = (result as any).rows?.[0] || (result as any)[0];
  const completed = Number(row?.completed || 0);
  const noShow = Number(row?.no_show || 0);
  const cancelled = Number(row?.cancelled || 0);

  const totalForReliability = completed + noShow + cancelled;
  const totalForCompletion = completed + noShow;

  return {
    completedCount: completed,
    missedCount: noShow,
    cancelledByDriverCount: cancelled,
    totalTrips: totalForReliability,
    // Default to 0.8 if no history (same convention as autoAssignV2Engine)
    reliabilityScore: totalForReliability > 0 ? completed / totalForReliability : 0.8,
    // Default to 0.9 if no history — conservative, not enough data for auto-accept
    completionRate: totalForCompletion > 0 ? completed / totalForCompletion : 0.9,
  };
}

/**
 * Check whether a driver qualifies for auto-accept.
 * Returns eligibility status and the computed stats.
 */
export async function checkDriverAutoAcceptEligibility(
  driverId: number,
  companyId: number,
): Promise<{
  eligible: boolean;
  reason: string;
  stats?: DriverStats;
}> {
  // Check company has auto-assign (and thus auto-accept) enabled
  const [company] = await db
    .select({ autoAssignV2Enabled: companies.autoAssignV2Enabled })
    .from(companies)
    .where(eq(companies.id, companyId));

  if (!company) {
    return { eligible: false, reason: "Company not found" };
  }

  if (!company.autoAssignV2Enabled) {
    return { eligible: false, reason: "Auto-assign/auto-accept not enabled for company" };
  }

  // Ensure driver exists and is active
  const [driver] = await db
    .select({ id: drivers.id, status: drivers.status, active: drivers.active })
    .from(drivers)
    .where(eq(drivers.id, driverId));

  if (!driver || !driver.active || driver.status !== "ACTIVE") {
    return { eligible: false, reason: "Driver not active" };
  }

  // Compute stats
  const stats = await getDriverStats(driverId);

  // Need a minimum trip history to qualify — at least 10 completed trips in 30 days
  if (stats.totalTrips < 10) {
    return {
      eligible: false,
      reason: `Insufficient trip history (${stats.totalTrips} trips in last ${LOOKBACK_DAYS} days, need 10+)`,
      stats,
    };
  }

  if (stats.reliabilityScore < AUTO_ACCEPT_RELIABILITY_THRESHOLD) {
    return {
      eligible: false,
      reason: `Reliability score ${(stats.reliabilityScore * 100).toFixed(1)}% below ${AUTO_ACCEPT_RELIABILITY_THRESHOLD * 100}% threshold`,
      stats,
    };
  }

  if (stats.completionRate < AUTO_ACCEPT_COMPLETION_RATE_THRESHOLD) {
    return {
      eligible: false,
      reason: `Completion rate ${(stats.completionRate * 100).toFixed(1)}% below ${AUTO_ACCEPT_COMPLETION_RATE_THRESHOLD * 100}% threshold`,
      stats,
    };
  }

  return { eligible: true, reason: "Driver qualifies for auto-accept", stats };
}

/**
 * Attempt to auto-accept a trip for a driver.
 * If the driver qualifies, transitions the trip from ASSIGNED -> EN_ROUTE_TO_PICKUP,
 * sends a push notification, and logs the automation event.
 *
 * Returns whether auto-accept was performed.
 */
export async function attemptAutoAccept(
  tripId: number,
  driverId: number,
): Promise<{ autoAccepted: boolean; reason: string }> {
  try {
    // Look up the trip to get companyId
    const [trip] = await db
      .select({ id: trips.id, status: trips.status, companyId: trips.companyId })
      .from(trips)
      .where(eq(trips.id, tripId));

    if (!trip) {
      return { autoAccepted: false, reason: "Trip not found" };
    }

    if (trip.status !== "ASSIGNED") {
      return { autoAccepted: false, reason: `Trip status is ${trip.status}, not ASSIGNED` };
    }

    // Check eligibility
    const eligibility = await checkDriverAutoAcceptEligibility(driverId, trip.companyId);
    if (!eligibility.eligible) {
      console.log(
        JSON.stringify({
          event: "auto_accept_skipped",
          tripId,
          driverId,
          reason: eligibility.reason,
        }),
      );
      return { autoAccepted: false, reason: eligibility.reason };
    }

    // Transition trip to EN_ROUTE_TO_PICKUP
    const transitionResult = await transitionTripStatus(tripId, "EN_ROUTE_TO_PICKUP", {
      userId: 0, // system actor
      role: "SYSTEM",
      source: "auto_accept",
    });

    if (!transitionResult.success) {
      console.warn(
        `[AUTO-ACCEPT] Transition failed for trip ${tripId}: ${transitionResult.error}`,
      );
      return { autoAccepted: false, reason: transitionResult.error || "Transition failed" };
    }

    // Log automation event
    await db.insert(automationEvents).values({
      eventType: "auto_accept",
      tripId,
      driverId,
      companyId: trip.companyId,
      payload: {
        reliabilityScore: eligibility.stats?.reliabilityScore,
        completionRate: eligibility.stats?.completionRate,
        totalTrips: eligibility.stats?.totalTrips,
        previousStatus: "ASSIGNED",
        newStatus: "EN_ROUTE_TO_PICKUP",
      },
    });

    // Send push notification to driver
    try {
      await sendPushToDriver(driverId, {
        title: "Trip Auto-Accepted",
        body: "A new trip has been auto-accepted for you based on your high performance rating. Navigation is ready.",
        data: {
          type: "auto_accept",
          tripId: String(tripId),
          action: "navigate",
        },
      });
    } catch (pushErr: any) {
      // Push failure should not block auto-accept
      console.warn(`[AUTO-ACCEPT] Push notification failed for driver ${driverId}:`, pushErr.message);
    }

    console.log(
      JSON.stringify({
        event: "auto_accept_success",
        tripId,
        driverId,
        reliabilityScore: eligibility.stats?.reliabilityScore,
        completionRate: eligibility.stats?.completionRate,
      }),
    );

    return { autoAccepted: true, reason: "Trip auto-accepted for high-rated driver" };
  } catch (err: any) {
    console.error(`[AUTO-ACCEPT] Error for trip ${tripId}, driver ${driverId}:`, err.message);
    return { autoAccepted: false, reason: `Error: ${err.message}` };
  }
}
