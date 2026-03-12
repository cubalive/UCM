/**
 * Late Trip Prediction Engine
 *
 * Real-time lateness probability for active trips by analyzing:
 * - Current driver location vs remaining distance
 * - Time since last status update (stale location = risk)
 * - Driver's historical on-time rate
 * - Current time vs scheduled pickup time
 * - Traffic multiplier by hour (rush hour = higher risk)
 * - Trip distance (longer trips = more variance)
 */

import { db } from "../db";
import { trips, drivers, driverScores } from "@shared/schema";
import { eq, and, sql, gte, isNull, desc } from "drizzle-orm";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface LatenessPrediction {
  tripId: number;
  probability: number; // 0-100
  estimatedDelayMinutes: number;
  riskLevel: "on_time" | "at_risk" | "likely_late" | "critical";
  factors: Array<{ name: string; impact: number; detail: string }>;
  recommendations: Array<{
    action: string;
    description: string;
    priority: "low" | "medium" | "high";
  }>;
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

// ─── Traffic Multiplier by Hour ─────────────────────────────────────────────

function getTrafficMultiplier(hour: number): { multiplier: number; label: string } {
  if (hour >= 7 && hour <= 9) return { multiplier: 1.5, label: "Morning rush hour" };
  if (hour >= 16 && hour <= 18) return { multiplier: 1.4, label: "Evening rush hour" };
  if (hour >= 11 && hour <= 13) return { multiplier: 1.15, label: "Lunch hour" };
  if (hour >= 20 || hour <= 5) return { multiplier: 0.85, label: "Low traffic" };
  return { multiplier: 1.0, label: "Normal traffic" };
}

// ─── Core Prediction ────────────────────────────────────────────────────────

export async function predictLateness(tripId: number): Promise<LatenessPrediction> {
  // Fetch the trip
  const [trip] = await db
    .select({
      id: trips.id,
      driverId: trips.driverId,
      scheduledDate: trips.scheduledDate,
      pickupTime: trips.pickupTime,
      pickupLat: trips.pickupLat,
      pickupLng: trips.pickupLng,
      dropoffLat: trips.dropoffLat,
      dropoffLng: trips.dropoffLng,
      status: trips.status,
      distanceMiles: trips.distanceMiles,
      durationMinutes: trips.durationMinutes,
      startedAt: trips.startedAt,
      arrivedPickupAt: trips.arrivedPickupAt,
      pickedUpAt: trips.pickedUpAt,
      companyId: trips.companyId,
      cityId: trips.cityId,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), isNull(trips.deletedAt)))
    .limit(1);

  if (!trip) {
    return {
      tripId,
      probability: 0,
      estimatedDelayMinutes: 0,
      riskLevel: "on_time",
      factors: [{ name: "Trip not found", impact: 0, detail: "Trip does not exist" }],
      recommendations: [],
    };
  }

  const factors: LatenessPrediction["factors"] = [];
  const recommendations: LatenessPrediction["recommendations"] = [];
  let probability = 10; // baseline
  let estimatedDelayMinutes = 0;

  const now = new Date();
  const currentHour = now.getHours();

  // ── Factor 1: Driver assignment ──
  if (!trip.driverId) {
    probability += 40;
    estimatedDelayMinutes += 20;
    factors.push({
      name: "No driver assigned",
      impact: 40,
      detail: "Trip has no assigned driver — critical risk",
    });
    recommendations.push({
      action: "Assign driver immediately",
      description: "Find and assign the closest available driver",
      priority: "high",
    });
  }

  // ── Factor 2: Current driver location vs pickup ──
  if (trip.driverId && trip.pickupLat && trip.pickupLng) {
    const [driver] = await db
      .select({
        lastLat: drivers.lastLat,
        lastLng: drivers.lastLng,
        lastSeenAt: drivers.lastSeenAt,
        firstName: drivers.firstName,
        lastName: drivers.lastName,
        dispatchStatus: drivers.dispatchStatus,
      })
      .from(drivers)
      .where(eq(drivers.id, trip.driverId))
      .limit(1);

    if (driver) {
      // Check if driver has a recent location
      if (driver.lastLat && driver.lastLng) {
        const distanceToPickup = haversineMiles(
          driver.lastLat,
          driver.lastLng,
          trip.pickupLat,
          trip.pickupLng,
        );

        // Parse scheduled pickup time
        const pickupTimeMatch = trip.pickupTime?.match(/^(\d{1,2}):(\d{2})/);
        if (pickupTimeMatch && trip.scheduledDate) {
          const pickupHour = parseInt(pickupTimeMatch[1], 10);
          const pickupMin = parseInt(pickupTimeMatch[2], 10);

          const pickupDateTime = new Date(trip.scheduledDate + "T00:00:00");
          pickupDateTime.setHours(pickupHour, pickupMin, 0, 0);

          const minutesUntilPickup = (pickupDateTime.getTime() - now.getTime()) / 60000;

          // Estimate travel time: assume 25 mph average in urban areas
          const traffic = getTrafficMultiplier(currentHour);
          const estimatedTravelMin = (distanceToPickup / 25) * 60 * traffic.multiplier;

          if (minutesUntilPickup > 0 && !trip.arrivedPickupAt) {
            const timeBuffer = minutesUntilPickup - estimatedTravelMin;

            if (timeBuffer < -10) {
              // Already late
              const impact = Math.min(40, Math.round(Math.abs(timeBuffer) * 2));
              probability += impact;
              estimatedDelayMinutes += Math.round(Math.abs(timeBuffer));
              factors.push({
                name: "Driver distance vs time remaining",
                impact,
                detail: `Driver is ${distanceToPickup.toFixed(1)} mi away, ~${Math.round(estimatedTravelMin)} min travel but only ${Math.round(minutesUntilPickup)} min until pickup`,
              });
            } else if (timeBuffer < 5) {
              const impact = 15;
              probability += impact;
              estimatedDelayMinutes += Math.round(Math.max(0, estimatedTravelMin - minutesUntilPickup));
              factors.push({
                name: "Driver distance vs time remaining",
                impact,
                detail: `Tight window: ${Math.round(timeBuffer)} min buffer for ${distanceToPickup.toFixed(1)} mi trip`,
              });
            } else if (timeBuffer > 30) {
              const impact = -5;
              probability += impact;
              factors.push({
                name: "Driver distance vs time remaining",
                impact,
                detail: `Comfortable buffer: ${Math.round(timeBuffer)} min for ${distanceToPickup.toFixed(1)} mi`,
              });
            }
          }
        }

        // ── Factor 3: Time since last location update ──
        if (driver.lastSeenAt) {
          const minutesSinceUpdate = (now.getTime() - new Date(driver.lastSeenAt).getTime()) / 60000;
          if (minutesSinceUpdate > 30) {
            const impact = Math.min(15, Math.round(minutesSinceUpdate / 5));
            probability += impact;
            factors.push({
              name: "Stale driver location",
              impact,
              detail: `No location update for ${Math.round(minutesSinceUpdate)} minutes — driver may be unreachable`,
            });
            recommendations.push({
              action: "Contact driver",
              description: `No GPS update for ${Math.round(minutesSinceUpdate)} min — verify driver status`,
              priority: "high",
            });
          } else if (minutesSinceUpdate > 15) {
            const impact = 5;
            probability += impact;
            factors.push({
              name: "Location update gap",
              impact,
              detail: `Last update ${Math.round(minutesSinceUpdate)} minutes ago`,
            });
          }
        }

        // Find nearby drivers for reassignment recommendation
        if (probability > 50) {
          const nearbyDrivers = await db
            .select({
              id: drivers.id,
              firstName: drivers.firstName,
              lastName: drivers.lastName,
              lastLat: drivers.lastLat,
              lastLng: drivers.lastLng,
            })
            .from(drivers)
            .where(
              and(
                eq(drivers.companyId, trip.companyId),
                eq(drivers.status, "ACTIVE"),
                sql`${drivers.dispatchStatus} = 'available'`,
                sql`${drivers.id} != ${trip.driverId}`,
                isNull(drivers.deletedAt),
                sql`${drivers.lastLat} IS NOT NULL`,
              ),
            )
            .limit(5);

          for (const nd of nearbyDrivers) {
            if (nd.lastLat && nd.lastLng && trip.pickupLat && trip.pickupLng) {
              const dist = haversineMiles(nd.lastLat, nd.lastLng, trip.pickupLat, trip.pickupLng);
              const estMin = Math.round((dist / 25) * 60);
              if (dist < 15) {
                recommendations.push({
                  action: `Reassign to ${nd.firstName} ${nd.lastName}`,
                  description: `${nd.firstName} ${nd.lastName} is ${dist.toFixed(1)} mi away (~${estMin} min)`,
                  priority: "medium",
                });
                break; // only suggest closest
              }
            }
          }
        }
      }
    }
  }

  // ── Factor 4: Driver's historical on-time rate ──
  if (trip.driverId) {
    const scores = await db
      .select({
        onTimeRate: driverScores.onTimeRate,
        totalTrips: driverScores.totalTrips,
      })
      .from(driverScores)
      .where(eq(driverScores.driverId, trip.driverId))
      .orderBy(desc(driverScores.weekStart))
      .limit(4);

    if (scores.length > 0) {
      const avgOnTimeRate =
        scores.reduce((s, sc) => s + (sc.onTimeRate ?? 0), 0) / scores.length;

      if (avgOnTimeRate < 0.7) {
        const impact = Math.round((0.7 - avgOnTimeRate) * 40);
        probability += impact;
        factors.push({
          name: "Driver on-time history",
          impact,
          detail: `Driver's avg on-time rate is ${Math.round(avgOnTimeRate * 100)}% (below 70% threshold)`,
        });
      } else if (avgOnTimeRate > 0.9) {
        const impact = -5;
        probability += impact;
        factors.push({
          name: "Driver on-time history",
          impact,
          detail: `Reliable driver — ${Math.round(avgOnTimeRate * 100)}% on-time rate`,
        });
      }
    }
  }

  // ── Factor 5: Traffic conditions ──
  const traffic = getTrafficMultiplier(currentHour);
  if (traffic.multiplier > 1.1) {
    const impact = Math.round((traffic.multiplier - 1.0) * 20);
    probability += impact;
    estimatedDelayMinutes += Math.round(impact * 0.5);
    factors.push({
      name: "Traffic conditions",
      impact,
      detail: `${traffic.label} — ${Math.round((traffic.multiplier - 1) * 100)}% slower travel expected`,
    });
  } else if (traffic.multiplier < 1.0) {
    const impact = Math.round((traffic.multiplier - 1.0) * 15);
    probability += impact;
    factors.push({
      name: "Traffic conditions",
      impact,
      detail: `${traffic.label} — favorable conditions`,
    });
  }

  // ── Factor 6: Trip distance ──
  if (trip.distanceMiles) {
    const miles = parseFloat(trip.distanceMiles);
    if (miles > 30) {
      const impact = Math.min(10, Math.round((miles - 30) / 10) * 3);
      probability += impact;
      estimatedDelayMinutes += Math.round(impact * 0.5);
      factors.push({
        name: "Trip distance",
        impact,
        detail: `Long trip (${miles.toFixed(1)} mi) — more variance in travel time`,
      });
    }
  }

  // Clamp values
  probability = Math.max(0, Math.min(100, Math.round(probability)));
  estimatedDelayMinutes = Math.max(0, Math.round(estimatedDelayMinutes));

  // Determine risk level
  let riskLevel: LatenessPrediction["riskLevel"];
  if (probability >= 70) riskLevel = "critical";
  else if (probability >= 50) riskLevel = "likely_late";
  else if (probability >= 25) riskLevel = "at_risk";
  else riskLevel = "on_time";

  // Generate recommendations based on probability
  if (probability >= 70) {
    if (!recommendations.some((r) => r.action.startsWith("Reassign"))) {
      recommendations.push({
        action: "Consider reassigning to closer driver",
        description: "Trip is likely to be late — check for available nearby drivers",
        priority: "high",
      });
    }
    recommendations.push({
      action: "Send updated ETA to patient",
      description: `Estimated ${estimatedDelayMinutes} min delay — notify patient proactively`,
      priority: "high",
    });
    if (trip.clinicId) {
      recommendations.push({
        action: "Contact clinic to push appointment time",
        description: "Alert the clinic about the expected delay",
        priority: "medium",
      });
    }
  } else if (probability >= 50) {
    recommendations.push({
      action: "Send updated ETA to patient",
      description: "Trip is at risk of delay — keep patient informed",
      priority: "medium",
    });
  }

  return {
    tripId,
    probability,
    estimatedDelayMinutes,
    riskLevel,
    factors,
    recommendations,
  };
}

// ─── Batch Prediction for All Active Trips ──────────────────────────────────

export async function batchPredictLateness(companyId: number): Promise<LatenessPrediction[]> {
  const today = new Date().toISOString().slice(0, 10);

  // Get all active (non-completed) trips for today
  const activeTrips = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.scheduledDate, today),
        isNull(trips.deletedAt),
        sql`${trips.status} IN ('SCHEDULED', 'ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROPOFF')`,
      ),
    );

  const predictions: LatenessPrediction[] = [];

  for (const trip of activeTrips) {
    try {
      const prediction = await predictLateness(trip.id);
      predictions.push(prediction);
    } catch (err: any) {
      console.warn(`[LATE-PREDICT] Failed for trip ${trip.id}: ${err.message}`);
    }
  }

  // Sort by probability descending
  predictions.sort((a, b) => b.probability - a.probability);

  return predictions;
}
