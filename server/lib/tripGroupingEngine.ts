import { db } from "../db";
import {
  tripGroups,
  tripGroupMembers,
  trips,
  patients,
  drivers,
  vehicles,
} from "@shared/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";

const GROUPING_TIME_WINDOW_MINUTES = 30;
const GROUPING_DISTANCE_MILES = 3;
const MILES_TO_METERS = 1609.34;
const EARTH_RADIUS_MILES = 3958.8;

/**
 * Haversine distance in miles between two lat/lng pairs
 */
function haversineDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Parse a time string (HH:mm or similar) to minutes since midnight
 */
function timeToMinutes(time: string): number {
  const parts = time.split(":");
  if (parts.length < 2) return 0;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

interface GroupableTrip {
  id: number;
  patientId: number;
  pickupTime: string;
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffAddress: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  scheduledDate: string;
  cityId: number;
  companyId: number;
}

/**
 * Find trips going to similar destinations within similar time windows
 */
export async function findGroupableTrips(companyId: number, date: string) {
  const eligibleTrips = await db
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
        eq(trips.status, "SCHEDULED"),
        sql`${trips.dropoffLat} IS NOT NULL`,
        sql`${trips.dropoffLng} IS NOT NULL`
      )
    );

  // Group by proximity of destination and time window
  const suggestions: { trips: GroupableTrip[]; destination: string }[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < eligibleTrips.length; i++) {
    if (assigned.has(eligibleTrips[i].id)) continue;

    const cluster: GroupableTrip[] = [eligibleTrips[i] as GroupableTrip];
    assigned.add(eligibleTrips[i].id);

    const baseTime = timeToMinutes(eligibleTrips[i].pickupTime);
    const baseLat = eligibleTrips[i].dropoffLat!;
    const baseLng = eligibleTrips[i].dropoffLng!;

    for (let j = i + 1; j < eligibleTrips.length; j++) {
      if (assigned.has(eligibleTrips[j].id)) continue;
      if (!eligibleTrips[j].dropoffLat || !eligibleTrips[j].dropoffLng) continue;

      const timeDiff = Math.abs(
        timeToMinutes(eligibleTrips[j].pickupTime) - baseTime
      );
      if (timeDiff > GROUPING_TIME_WINDOW_MINUTES) continue;

      const dist = haversineDistanceMiles(
        baseLat,
        baseLng,
        eligibleTrips[j].dropoffLat!,
        eligibleTrips[j].dropoffLng!
      );
      if (dist > GROUPING_DISTANCE_MILES) continue;

      cluster.push(eligibleTrips[j] as GroupableTrip);
      assigned.add(eligibleTrips[j].id);
    }

    if (cluster.length >= 2) {
      suggestions.push({
        trips: cluster,
        destination: eligibleTrips[i].dropoffAddress,
      });
    }
  }

  return suggestions;
}

/**
 * Create a trip group from a set of trip IDs
 */
export async function createGroup(
  tripIds: number[],
  companyId: number,
  cityId: number,
  createdBy: number,
  driverId?: number
) {
  if (tripIds.length < 2) {
    throw new Error("A group requires at least 2 trips");
  }

  // Fetch the trips
  const groupTrips = await db
    .select()
    .from(trips)
    .where(inArray(trips.id, tripIds));

  if (groupTrips.length !== tripIds.length) {
    throw new Error("Some trips were not found");
  }

  // Derive group info from first trip
  const firstTrip = groupTrips[0];
  const pickupTimes = groupTrips
    .map((t) => t.pickupTime)
    .sort();

  const [group] = await db
    .insert(tripGroups)
    .values({
      groupName: `Group ${firstTrip.scheduledDate} - ${firstTrip.dropoffAddress.substring(0, 40)}`,
      companyId,
      cityId,
      scheduledDate: firstTrip.scheduledDate,
      estimatedPickupStart: pickupTimes[0],
      estimatedPickupEnd: pickupTimes[pickupTimes.length - 1],
      destinationAddress: firstTrip.dropoffAddress,
      destinationLat: firstTrip.dropoffLat,
      destinationLng: firstTrip.dropoffLng,
      driverId: driverId ?? null,
      vehicleId: null,
      maxPassengers: 4,
      currentPassengers: groupTrips.length,
      status: "forming",
      savingsEstimateCents: 0,
      createdBy,
    })
    .returning();

  // Add members
  for (let i = 0; i < groupTrips.length; i++) {
    const trip = groupTrips[i];
    await db.insert(tripGroupMembers).values({
      groupId: group.id,
      tripId: trip.id,
      patientId: trip.patientId,
      pickupOrder: i + 1,
      status: "pending",
    });
  }

  // Calculate initial savings estimate
  await calculateGroupSavings(group.id);

  return group;
}

/**
 * Add a trip to an existing group
 */
export async function addToGroup(groupId: number, tripId: number) {
  const [group] = await db
    .select()
    .from(tripGroups)
    .where(eq(tripGroups.id, groupId))
    .limit(1);

  if (!group) throw new Error("Group not found");
  if (group.status === "completed" || group.status === "cancelled") {
    throw new Error("Cannot modify a completed or cancelled group");
  }
  if (group.currentPassengers >= group.maxPassengers) {
    throw new Error("Group is at maximum capacity");
  }

  const [trip] = await db
    .select()
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);

  if (!trip) throw new Error("Trip not found");

  // Check not already in a group
  const existing = await db
    .select()
    .from(tripGroupMembers)
    .where(
      and(
        eq(tripGroupMembers.tripId, tripId),
        sql`${tripGroupMembers.status} != 'removed'`
      )
    )
    .limit(1);

  if (existing.length > 0) {
    throw new Error("Trip is already in a group");
  }

  const [member] = await db
    .insert(tripGroupMembers)
    .values({
      groupId,
      tripId,
      patientId: trip.patientId,
      pickupOrder: group.currentPassengers + 1,
      status: "pending",
    })
    .returning();

  await db
    .update(tripGroups)
    .set({ currentPassengers: group.currentPassengers + 1 })
    .where(eq(tripGroups.id, groupId));

  await calculateGroupSavings(groupId);

  return member;
}

/**
 * Remove a trip from a group
 */
export async function removeFromGroup(groupId: number, tripId: number) {
  const [group] = await db
    .select()
    .from(tripGroups)
    .where(eq(tripGroups.id, groupId))
    .limit(1);

  if (!group) throw new Error("Group not found");

  const [member] = await db
    .update(tripGroupMembers)
    .set({ status: "removed" })
    .where(
      and(
        eq(tripGroupMembers.groupId, groupId),
        eq(tripGroupMembers.tripId, tripId)
      )
    )
    .returning();

  if (!member) throw new Error("Trip not found in group");

  const newCount = Math.max(0, group.currentPassengers - 1);
  await db
    .update(tripGroups)
    .set({ currentPassengers: newCount })
    .where(eq(tripGroups.id, groupId));

  // If only 1 or 0 members left, cancel the group
  if (newCount < 2) {
    await db
      .update(tripGroups)
      .set({ status: "cancelled" })
      .where(eq(tripGroups.id, groupId));
  }

  await calculateGroupSavings(groupId);

  return member;
}

/**
 * Estimate cost savings for a group vs individual trips
 */
export async function calculateGroupSavings(groupId: number) {
  const members = await db
    .select()
    .from(tripGroupMembers)
    .where(
      and(
        eq(tripGroupMembers.groupId, groupId),
        sql`${tripGroupMembers.status} != 'removed'`
      )
    );

  if (members.length < 2) {
    await db
      .update(tripGroups)
      .set({ savingsEstimateCents: 0 })
      .where(eq(tripGroups.id, groupId));
    return 0;
  }

  // Fetch trip pricing
  const memberTripIds = members.map((m) => m.tripId);
  const memberTrips = await db
    .select({ id: trips.id, priceTotalCents: trips.priceTotalCents })
    .from(trips)
    .where(inArray(trips.id, memberTripIds));

  const totalIndividualCents = memberTrips.reduce(
    (sum, t) => sum + (t.priceTotalCents || 0),
    0
  );

  // Estimate shared ride cost: base cost of one trip + 30% per additional passenger
  const baseCost = memberTrips[0]?.priceTotalCents || 0;
  const additionalCost = baseCost * 0.3 * (members.length - 1);
  const groupCost = Math.round(baseCost + additionalCost);
  const savings = Math.max(0, totalIndividualCents - groupCost);

  await db
    .update(tripGroups)
    .set({ savingsEstimateCents: savings })
    .where(eq(tripGroups.id, groupId));

  return savings;
}

/**
 * Optimize pickup/dropoff order for the group using nearest-neighbor heuristic
 */
export async function optimizeGroupPickupOrder(groupId: number) {
  const members = await db
    .select({
      id: tripGroupMembers.id,
      tripId: tripGroupMembers.tripId,
      pickupLat: trips.pickupLat,
      pickupLng: trips.pickupLng,
    })
    .from(tripGroupMembers)
    .innerJoin(trips, eq(tripGroupMembers.tripId, trips.id))
    .where(
      and(
        eq(tripGroupMembers.groupId, groupId),
        sql`${tripGroupMembers.status} != 'removed'`
      )
    );

  if (members.length < 2) return members;

  // Nearest-neighbor ordering starting from the first member
  const ordered: typeof members = [];
  const remaining = [...members];
  let current = remaining.shift()!;
  ordered.push(current);

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      if (!current.pickupLat || !current.pickupLng || !remaining[i].pickupLat || !remaining[i].pickupLng) {
        continue;
      }
      const dist = haversineDistanceMiles(
        current.pickupLat,
        current.pickupLng,
        remaining[i].pickupLat!,
        remaining[i].pickupLng!
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    current = remaining.splice(nearestIdx, 1)[0];
    ordered.push(current);
  }

  // Update pickup orders
  for (let i = 0; i < ordered.length; i++) {
    await db
      .update(tripGroupMembers)
      .set({ pickupOrder: i + 1, dropoffOrder: ordered.length - i })
      .where(eq(tripGroupMembers.id, ordered[i].id));
  }

  return ordered;
}

/**
 * Auto-detect and suggest groupings for a company on a given date
 */
export async function autoGroupTrips(companyId: number, date: string) {
  return findGroupableTrips(companyId, date);
}

/**
 * Get group details with members
 */
export async function getGroupDetails(groupId: number) {
  const [group] = await db
    .select()
    .from(tripGroups)
    .where(eq(tripGroups.id, groupId))
    .limit(1);

  if (!group) return null;

  const members = await db
    .select({
      id: tripGroupMembers.id,
      tripId: tripGroupMembers.tripId,
      patientId: tripGroupMembers.patientId,
      pickupOrder: tripGroupMembers.pickupOrder,
      dropoffOrder: tripGroupMembers.dropoffOrder,
      status: tripGroupMembers.status,
      addedAt: tripGroupMembers.addedAt,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      pickupAddress: trips.pickupAddress,
      pickupTime: trips.pickupTime,
      tripStatus: trips.status,
    })
    .from(tripGroupMembers)
    .innerJoin(trips, eq(tripGroupMembers.tripId, trips.id))
    .innerJoin(patients, eq(tripGroupMembers.patientId, patients.id))
    .where(
      and(
        eq(tripGroupMembers.groupId, groupId),
        sql`${tripGroupMembers.status} != 'removed'`
      )
    )
    .orderBy(tripGroupMembers.pickupOrder);

  return { ...group, members };
}

/**
 * List groups for a company/city on a date
 */
export async function listGroups(
  companyId: number,
  date?: string,
  cityId?: number
) {
  const conditions = [eq(tripGroups.companyId, companyId)];
  if (date) conditions.push(eq(tripGroups.scheduledDate, date));
  if (cityId) conditions.push(eq(tripGroups.cityId, cityId));

  const groups = await db
    .select()
    .from(tripGroups)
    .where(and(...conditions))
    .orderBy(desc(tripGroups.createdAt));

  return groups;
}

/**
 * Savings report for a company
 */
export async function savingsReport(companyId: number, startDate?: string, endDate?: string) {
  const conditions = [eq(tripGroups.companyId, companyId)];
  if (startDate) {
    conditions.push(sql`${tripGroups.scheduledDate} >= ${startDate}`);
  }
  if (endDate) {
    conditions.push(sql`${tripGroups.scheduledDate} <= ${endDate}`);
  }

  const groups = await db
    .select()
    .from(tripGroups)
    .where(and(...conditions));

  const totalGroups = groups.length;
  const totalSavingsCents = groups.reduce((sum, g) => sum + g.savingsEstimateCents, 0);
  const totalPassengersGrouped = groups.reduce((sum, g) => sum + g.currentPassengers, 0);
  const completedGroups = groups.filter((g) => g.status === "completed").length;
  const activeGroups = groups.filter(
    (g) => g.status === "forming" || g.status === "confirmed" || g.status === "in_progress"
  ).length;

  return {
    totalGroups,
    completedGroups,
    activeGroups,
    totalSavingsCents,
    totalPassengersGrouped,
    avgSavingsPerGroupCents: totalGroups > 0 ? Math.round(totalSavingsCents / totalGroups) : 0,
  };
}
