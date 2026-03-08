import { getDb } from "../db/index.js";
import { users, trips, driverStatus } from "../db/schema.js";
import { eq, and, sql, inArray } from "drizzle-orm";
import { assignTrip } from "./tripService.js";
import { isDriverOnline } from "./realtimeService.js";
import { broadcastToRole, WS_EVENTS } from "./realtimeService.js";
import logger from "../lib/logger.js";
import type { AutoAssignConfig, DriverScoreBreakdown, DispatchEvent } from "../types/dispatch.js";
import { DEFAULT_AUTO_ASSIGN_CONFIG } from "../types/dispatch.js";

interface DriverCandidate {
  driverId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  activeTrips: number;
  score: number;
  breakdown: DriverScoreBreakdown;
}

function emitDispatchEvent(event: DispatchEvent): void {
  logger.info("dispatch_event", {
    eventType: event.type,
    tenantId: event.tenantId,
    timestamp: event.timestamp.toISOString(),
    ...event.payload,
  });
}

export async function findBestDriver(
  tenantId: string,
  pickupLat?: number,
  pickupLng?: number,
  excludeDriverIds?: string[],
  configOverrides?: Partial<AutoAssignConfig>
): Promise<DriverCandidate | null> {
  const cfg = { ...DEFAULT_AUTO_ASSIGN_CONFIG, ...configOverrides };
  const db = getDb();

  const availableDrivers = await db
    .select({
      driverId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      latitude: driverStatus.latitude,
      longitude: driverStatus.longitude,
      lastLocationAt: driverStatus.lastLocationAt,
    })
    .from(users)
    .innerJoin(driverStatus, eq(users.id, driverStatus.driverId))
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.role, "driver"),
        eq(users.active, true),
        eq(driverStatus.availability, "available")
      )
    );

  if (availableDrivers.length === 0) return null;

  // Filter excluded drivers in-memory
  const eligible = excludeDriverIds?.length
    ? availableDrivers.filter(d => !excludeDriverIds.includes(d.driverId))
    : availableDrivers;

  if (eligible.length === 0) return null;

  const driverIds = eligible.map(d => d.driverId);

  // Batch queries: active trip counts, completion stats, and decline stats in parallel
  const [tripCounts, completionStats, declineStats] = await Promise.all([
    // Active trip counts per driver (single query)
    db
      .select({
        driverId: trips.driverId,
        count: sql<number>`count(*)`,
      })
      .from(trips)
      .where(
        and(
          inArray(trips.driverId, driverIds),
          sql`${trips.status} IN ('assigned', 'en_route', 'arrived', 'in_progress')`
        )
      )
      .groupBy(trips.driverId),

    // Completion stats per driver (single query)
    db
      .select({
        driverId: trips.driverId,
        total: sql<number>`count(*)`,
        onTime: sql<number>`count(case when ${trips.completedAt} is not null then 1 end)`,
      })
      .from(trips)
      .where(
        and(
          inArray(trips.driverId, driverIds),
          sql`${trips.status} = 'completed'`,
          sql`${trips.createdAt} > now() - interval '30 days'`
        )
      )
      .groupBy(trips.driverId),

    // Recent decline counts per driver (single query)
    db
      .select({
        driverId: sql<string>`(${trips.metadata}->>'declinedBy')::text`,
        count: sql<number>`count(*)`,
      })
      .from(trips)
      .where(
        and(
          sql`(${trips.metadata}->>'declinedBy')::text = ANY(${sql`ARRAY[${sql.join(driverIds.map(id => sql`${id}`), sql`, `)}]`})`,
          sql`${trips.updatedAt} > now() - interval '1 hour'`
        )
      )
      .groupBy(sql`(${trips.metadata}->>'declinedBy')::text`),
  ]);

  // Build lookup maps
  const activeTripsMap = new Map(tripCounts.map(tc => [tc.driverId!, Number(tc.count)]));
  const completionMap = new Map(completionStats.map(cs => [cs.driverId!, { total: Number(cs.total), onTime: Number(cs.onTime) }]));
  const declineMap = new Map(declineStats.map(ds => [ds.driverId, Number(ds.count)]));

  const candidates: DriverCandidate[] = [];

  for (const driver of eligible) {
    const adjustments: DriverScoreBreakdown["adjustments"] = {
      proximity: 0,
      activeTrips: 0,
      staleLocation: 0,
      onlinePresence: 0,
      reliability: 0,
      recentDeclines: 0,
    };
    let score = 100;
    let disqualified = false;
    let disqualifyReason: string | undefined;

    // Active trip penalty — hard cap at configured max
    const activeTrips = activeTripsMap.get(driver.driverId) || 0;
    if (activeTrips >= cfg.maxActiveTripsPerDriver) {
      disqualified = true;
      disqualifyReason = `max active trips reached (${activeTrips}/${cfg.maxActiveTripsPerDriver})`;
      adjustments.activeTrips = -999;
      score = -999;
      candidates.push({
        driverId: driver.driverId,
        name: `${driver.firstName} ${driver.lastName}`,
        latitude: driver.latitude ? Number(driver.latitude) : null,
        longitude: driver.longitude ? Number(driver.longitude) : null,
        activeTrips,
        score,
        breakdown: { driverId: driver.driverId, baseScore: 100, adjustments, finalScore: score, disqualified, disqualifyReason },
      });
      continue;
    }
    const tripPenalty = activeTrips * 30;
    score -= tripPenalty;
    adjustments.activeTrips = -tripPenalty;

    // Proximity bonus
    if (pickupLat && pickupLng && driver.latitude && driver.longitude) {
      const distance = haversineDistance(
        pickupLat, pickupLng,
        Number(driver.latitude), Number(driver.longitude)
      );
      // Disqualify if beyond max distance
      if (distance > cfg.maxDistanceMiles) {
        disqualified = true;
        disqualifyReason = `too far (${Math.round(distance)} mi > ${cfg.maxDistanceMiles} mi)`;
        adjustments.proximity = -999;
        score = -999;
        candidates.push({
          driverId: driver.driverId,
          name: `${driver.firstName} ${driver.lastName}`,
          latitude: driver.latitude ? Number(driver.latitude) : null,
          longitude: driver.longitude ? Number(driver.longitude) : null,
          activeTrips,
          score,
          breakdown: { driverId: driver.driverId, baseScore: 100, adjustments, finalScore: score, disqualified, disqualifyReason },
        });
        continue;
      }
      const proximityBonus = Math.max(0, 50 - distance * cfg.proximityWeight);
      score += proximityBonus;
      adjustments.proximity = Math.round(proximityBonus);
    }

    // Stale location penalty
    if (driver.lastLocationAt) {
      const ageMinutes = (Date.now() - driver.lastLocationAt.getTime()) / 60000;
      if (ageMinutes > cfg.staleLocationThresholdMinutes) { score -= 50; adjustments.staleLocation = -50; }
      else if (ageMinutes > 10) { score -= 20; adjustments.staleLocation = -20; }
    } else {
      score -= 20;
      adjustments.staleLocation = -20;
    }

    // Online presence bonus
    if (isDriverOnline(driver.driverId)) {
      score += cfg.onlineBonus;
      adjustments.onlinePresence = cfg.onlineBonus;
    }

    // Reliability bonus from completion stats
    const stats = completionMap.get(driver.driverId);
    if (stats && stats.total >= 5) {
      const onTimeRate = stats.onTime / stats.total;
      const reliabilityBonus = Math.round(onTimeRate * cfg.reliabilityWeight);
      score += reliabilityBonus;
      adjustments.reliability = reliabilityBonus;
    }

    // Recent decline penalty
    const recentDeclines = declineMap.get(driver.driverId) || 0;
    if (recentDeclines > 0) {
      const declinePenalty = recentDeclines * cfg.declinePenaltyPerIncident;
      score -= declinePenalty;
      adjustments.recentDeclines = -declinePenalty;
    }

    candidates.push({
      driverId: driver.driverId,
      name: `${driver.firstName} ${driver.lastName}`,
      latitude: driver.latitude ? Number(driver.latitude) : null,
      longitude: driver.longitude ? Number(driver.longitude) : null,
      activeTrips,
      score,
      breakdown: { driverId: driver.driverId, baseScore: 100, adjustments, finalScore: score, disqualified, disqualifyReason },
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  logger.info("Auto-assign candidates scored", {
    tenantId,
    candidates: candidates.map((c) => ({
      name: c.name,
      score: c.score,
      disqualified: c.breakdown.disqualified,
      adjustments: c.breakdown.adjustments,
    })),
  });

  // Return best non-disqualified candidate
  const best = candidates.find(c => !c.breakdown.disqualified);
  return best || null;
}

export async function autoAssignTrip(tripId: string, tenantId: string, configOverrides?: Partial<AutoAssignConfig>): Promise<boolean> {
  const db = getDb();
  // Tenant-scoped trip fetch
  const [trip] = await db.select().from(trips).where(
    and(eq(trips.id, tripId), eq(trips.tenantId, tenantId))
  );

  if (!trip) {
    logger.warn("Auto-assign: trip not found", { tripId, tenantId });
    return false;
  }

  // Collect drivers who already declined this trip
  const declinedBy: string[] = [];
  if (trip.metadata && typeof trip.metadata === "object") {
    const meta = trip.metadata as Record<string, unknown>;
    if (meta.previousDriverId) declinedBy.push(meta.previousDriverId as string);
    // Also track all previous decliners from decline history
    if (Array.isArray(meta.declinedByHistory)) {
      declinedBy.push(...(meta.declinedByHistory as string[]));
    }
  }

  // Extract pickup coordinates from trip columns first, fallback to metadata
  const meta = (trip.metadata && typeof trip.metadata === "object") ? trip.metadata as Record<string, unknown> : {};
  const pickupLat = trip.pickupLat ? Number(trip.pickupLat) : (meta.pickupLat ? Number(meta.pickupLat) : undefined);
  const pickupLng = trip.pickupLng ? Number(trip.pickupLng) : (meta.pickupLng ? Number(meta.pickupLng) : undefined);

  const bestDriver = await findBestDriver(tenantId, pickupLat, pickupLng, declinedBy, configOverrides);

  if (!bestDriver) {
    logger.warn("Auto-assign: no available drivers", { tripId, tenantId });

    broadcastToRole(tenantId, "dispatcher", WS_EVENTS.URGENT_TRIP_REQUEST, {
      tripId,
      message: "No drivers available for auto-assignment — manual assignment required",
    });

    return false;
  }

  try {
    await assignTrip(tripId, bestDriver.driverId, tenantId, "system:auto-assign");

    // Emit structured dispatch event
    emitDispatchEvent({
      type: "trip_assigned",
      timestamp: new Date(),
      tenantId,
      payload: {
        tripId,
        driverId: bestDriver.driverId,
        driverName: bestDriver.name,
        assignedBy: "system:auto-assign",
        score: bestDriver.score,
        adjustments: bestDriver.breakdown.adjustments,
      },
    });

    logger.info("Auto-assign successful", {
      tripId,
      driverId: bestDriver.driverId,
      driverName: bestDriver.name,
      score: bestDriver.score,
      breakdown: bestDriver.breakdown,
    });
    return true;
  } catch (err: any) {
    logger.error("Auto-assign failed", { tripId, error: err.message });
    return false;
  }
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
