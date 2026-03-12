import { db } from "../db";
import { companies, trips, tripGroups, tripGroupMembers, automationEvents } from "@shared/schema";
import { eq, and, sql, isNull, inArray } from "drizzle-orm";
import { findGroupableTrips, createGroup, optimizeGroupPickupOrder } from "./tripGroupingEngine";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";

const SCHEDULER_INTERVAL_MS = 15 * 60_000; // Every 15 minutes
const MIN_GROUP_SIZE = 2;
const MAX_AUTO_GROUPS_PER_RUN = 10;

/**
 * Find trips with similar pickup locations going to different destinations
 * (complements the existing destination-based grouping)
 */
async function findPickupClusterTrips(companyId: number, date: string) {
  const PICKUP_WINDOW_MINUTES = 45;
  const PICKUP_DISTANCE_MILES = 2;
  const EARTH_RADIUS_MILES = 3958.8;

  function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function timeToMinutes(time: string): number {
    const parts = time.split(":");
    if (parts.length < 2) return 0;
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  const eligible = await db
    .select({
      id: trips.id,
      patientId: trips.patientId,
      pickupTime: trips.pickupTime,
      pickupAddress: trips.pickupAddress,
      pickupLat: trips.pickupLat,
      pickupLng: trips.pickupLng,
      dropoffAddress: trips.dropoffAddress,
      dropoffLat: trips.dropoffLat,
      dropoffLng: trips.dropoffLng,
      scheduledDate: trips.scheduledDate,
      cityId: trips.cityId,
      companyId: trips.companyId,
    })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.scheduledDate, date),
        inArray(trips.status, ["SCHEDULED"]),
        isNull(trips.deletedAt),
        sql`${trips.pickupLat} IS NOT NULL`,
        sql`${trips.pickupLng} IS NOT NULL`
      )
    );

  // Check which trips are already in a group
  const tripIds = eligible.map((t) => t.id);
  if (tripIds.length === 0) return [];

  const existingMembers = await db
    .select({ tripId: tripGroupMembers.tripId })
    .from(tripGroupMembers)
    .where(
      and(
        inArray(tripGroupMembers.tripId, tripIds),
        sql`${tripGroupMembers.status} != 'removed'`
      )
    );
  const alreadyGrouped = new Set(existingMembers.map((m) => m.tripId));
  const ungrouped = eligible.filter((t) => !alreadyGrouped.has(t.id));

  // Cluster by pickup proximity + time window
  const suggestions: { trips: typeof ungrouped; pickupArea: string; type: "pickup_cluster" }[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < ungrouped.length; i++) {
    if (assigned.has(ungrouped[i].id)) continue;

    const cluster = [ungrouped[i]];
    assigned.add(ungrouped[i].id);

    const baseTime = timeToMinutes(ungrouped[i].pickupTime);
    const baseLat = ungrouped[i].pickupLat!;
    const baseLng = ungrouped[i].pickupLng!;

    for (let j = i + 1; j < ungrouped.length; j++) {
      if (assigned.has(ungrouped[j].id)) continue;
      if (!ungrouped[j].pickupLat || !ungrouped[j].pickupLng) continue;

      const timeDiff = Math.abs(timeToMinutes(ungrouped[j].pickupTime) - baseTime);
      if (timeDiff > PICKUP_WINDOW_MINUTES) continue;

      const dist = haversine(baseLat, baseLng, ungrouped[j].pickupLat!, ungrouped[j].pickupLng!);
      if (dist > PICKUP_DISTANCE_MILES) continue;

      cluster.push(ungrouped[j]);
      assigned.add(ungrouped[j].id);
    }

    if (cluster.length >= MIN_GROUP_SIZE) {
      suggestions.push({
        trips: cluster,
        pickupArea: ungrouped[i].pickupAddress,
        type: "pickup_cluster",
      });
    }
  }

  return suggestions;
}

/**
 * Run the auto-grouping logic for all companies
 */
async function runAutoGroupingCycle() {
  // Get all companies with auto-assign enabled (they benefit from grouping)
  const activeCompanies = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.autoAssignV2Enabled, true));

  if (activeCompanies.length === 0) return;

  let totalGroupsCreated = 0;
  let totalTripsGrouped = 0;

  for (const company of activeCompanies) {
    try {
      // Get today and tomorrow dates
      const today = new Date().toISOString().split("T")[0];
      const tomorrow = new Date(Date.now() + 86400_000).toISOString().split("T")[0];

      for (const date of [today, tomorrow]) {
        // Destination-based grouping (existing)
        const destSuggestions = await findGroupableTrips(company.id, date);

        // Pickup-based grouping (new)
        const pickupSuggestions = await findPickupClusterTrips(company.id, date);

        // Auto-create groups for suggestions with 3+ trips (high confidence)
        const allSuggestions = [
          ...destSuggestions.map((s) => ({ tripIds: s.trips.map((t) => t.id), cityId: s.trips[0].cityId, label: `dest:${s.destination}` })),
          ...pickupSuggestions.map((s) => ({ tripIds: s.trips.map((t) => t.id), cityId: s.trips[0].cityId, label: `pickup:${s.pickupArea}` })),
        ];

        for (const suggestion of allSuggestions) {
          if (totalGroupsCreated >= MAX_AUTO_GROUPS_PER_RUN) break;

          // Only auto-create for 3+ trips (high confidence groupings)
          if (suggestion.tripIds.length < 3) continue;

          try {
            const group = await createGroup(
              suggestion.tripIds,
              company.id,
              suggestion.cityId,
              0, // system-created (userId=0)
            );

            // Optimize pickup order automatically
            await optimizeGroupPickupOrder(group.id);

            totalGroupsCreated++;
            totalTripsGrouped += suggestion.tripIds.length;

            await db.insert(automationEvents).values({
              eventType: "AUTO_GROUP_CREATED",
              companyId: company.id,
              payload: {
                groupId: group.id,
                tripCount: suggestion.tripIds.length,
                label: suggestion.label,
                date,
              },
            });
          } catch (err: any) {
            // Trip might already be in a group — skip
            if (err.message?.includes("already in a group")) continue;
            console.warn(`[AUTO-GROUP] Failed to create group for ${company.name}: ${err.message}`);
          }
        }
      }
    } catch (err: any) {
      console.error(`[AUTO-GROUP] Error for company ${company.name}: ${err.message}`);
    }
  }

  if (totalGroupsCreated > 0) {
    console.log(JSON.stringify({
      event: "auto_group_cycle",
      groupsCreated: totalGroupsCreated,
      tripsGrouped: totalTripsGrouped,
    }));
  }
}

let schedulerTask: HarnessedTask | null = null;

export function startTripGroupingScheduler() {
  if (schedulerTask) return;

  schedulerTask = createHarnessedTask({
    name: "trip_grouping",
    lockKey: "scheduler:lock:trip_grouping",
    lockTtlSeconds: 120,
    timeoutMs: 300_000,
    fn: runAutoGroupingCycle,
  });

  registerInterval("trip_grouping", SCHEDULER_INTERVAL_MS, schedulerTask);
  console.log("[AUTO-GROUP] Trip grouping scheduler started (interval: 15min)");
}

export { findPickupClusterTrips };
