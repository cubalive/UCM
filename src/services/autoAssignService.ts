import { getDb } from "../db/index.js";
import { users, trips, driverStatus } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { assignTrip } from "./tripService.js";
import { isDriverOnline } from "./realtimeService.js";
import { broadcastToRole, WS_EVENTS } from "./realtimeService.js";
import logger from "../lib/logger.js";

interface DriverCandidate {
  driverId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  activeTrips: number;
  score: number;
  breakdown: Record<string, number>;
}

export async function findBestDriver(
  tenantId: string,
  pickupLat?: number,
  pickupLng?: number,
  excludeDriverIds?: string[]
): Promise<DriverCandidate | null> {
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

  const candidates: DriverCandidate[] = [];

  for (const driver of availableDrivers) {
    // Skip excluded drivers (e.g. those who already declined)
    if (excludeDriverIds?.includes(driver.driverId)) continue;

    // Count active trips
    const [activeCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(trips)
      .where(
        and(
          eq(trips.driverId, driver.driverId),
          sql`${trips.status} IN ('assigned', 'en_route', 'arrived', 'in_progress')`
        )
      );

    const activeTrips = Number(activeCount.count);
    const breakdown: Record<string, number> = {};
    let score = 100;

    // Penalize drivers with active trips
    const tripPenalty = activeTrips * 30;
    score -= tripPenalty;
    breakdown.activeTrips = -tripPenalty;

    // Proximity bonus
    if (pickupLat && pickupLng && driver.latitude && driver.longitude) {
      const distance = haversineDistance(
        pickupLat, pickupLng,
        Number(driver.latitude), Number(driver.longitude)
      );
      const proximityBonus = Math.max(0, 50 - distance * 5);
      score += proximityBonus;
      breakdown.proximity = Math.round(proximityBonus);
    }

    // Stale location penalty
    if (driver.lastLocationAt) {
      const ageMinutes = (Date.now() - driver.lastLocationAt.getTime()) / 60000;
      if (ageMinutes > 10) { score -= 20; breakdown.stale = -20; }
      if (ageMinutes > 30) { score -= 30; breakdown.veryStale = -30; }
    } else {
      score -= 20;
      breakdown.noLocation = -20;
    }

    // Online presence bonus
    if (isDriverOnline(driver.driverId)) {
      score += 15;
      breakdown.online = 15;
    }

    // On-time rate: check recently completed trips (approximate)
    const [completedStats] = await db
      .select({
        total: sql<number>`count(*)`,
        onTime: sql<number>`count(case when ${trips.completedAt} is not null then 1 end)`,
      })
      .from(trips)
      .where(
        and(
          eq(trips.driverId, driver.driverId),
          sql`${trips.status} = 'completed'`,
          sql`${trips.createdAt} > now() - interval '30 days'`
        )
      );

    const totalCompleted = Number(completedStats.total);
    if (totalCompleted >= 5) {
      const onTimeRate = Number(completedStats.onTime) / totalCompleted;
      const reliabilityBonus = Math.round(onTimeRate * 20);
      score += reliabilityBonus;
      breakdown.reliability = reliabilityBonus;
    }

    // Decline penalty: check if driver recently declined trips
    const [declineStats] = await db
      .select({ count: sql<number>`count(*)` })
      .from(trips)
      .where(
        and(
          sql`(${trips.metadata}->>'declinedBy')::text = ${driver.driverId}`,
          sql`${trips.updatedAt} > now() - interval '1 hour'`
        )
      );
    const recentDeclines = Number(declineStats.count);
    if (recentDeclines > 0) {
      const declinePenalty = recentDeclines * 15;
      score -= declinePenalty;
      breakdown.recentDeclines = -declinePenalty;
    }

    candidates.push({
      driverId: driver.driverId,
      name: `${driver.firstName} ${driver.lastName}`,
      latitude: driver.latitude ? Number(driver.latitude) : null,
      longitude: driver.longitude ? Number(driver.longitude) : null,
      activeTrips,
      score,
      breakdown,
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  logger.info("Auto-assign candidates scored", {
    tenantId,
    candidates: candidates.map((c) => ({ name: c.name, score: c.score, breakdown: c.breakdown })),
  });

  return candidates[0] || null;
}

export async function autoAssignTrip(tripId: string, tenantId: string): Promise<boolean> {
  // Get trip to extract pickup location if available
  const db = getDb();
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));

  // Collect drivers who already declined this trip
  const declinedBy: string[] = [];
  if (trip?.metadata && typeof trip.metadata === "object") {
    const meta = trip.metadata as Record<string, unknown>;
    if (meta.previousDriverId) declinedBy.push(meta.previousDriverId as string);
  }

  // Extract pickup coordinates from trip metadata if available
  const meta = (trip?.metadata && typeof trip.metadata === "object") ? trip.metadata as Record<string, unknown> : {};
  const pickupLat = meta.pickupLat ? Number(meta.pickupLat) : undefined;
  const pickupLng = meta.pickupLng ? Number(meta.pickupLng) : undefined;

  const bestDriver = await findBestDriver(tenantId, pickupLat, pickupLng, declinedBy);

  if (!bestDriver) {
    logger.warn("Auto-assign: no available drivers", { tripId, tenantId });

    // Fallback: notify dispatchers
    broadcastToRole(tenantId, "dispatcher", WS_EVENTS.URGENT_TRIP_REQUEST, {
      tripId,
      message: "No drivers available for auto-assignment — manual assignment required",
    });

    return false;
  }

  try {
    await assignTrip(tripId, bestDriver.driverId, tenantId, "system:auto-assign");
    logger.info("Auto-assign successful", {
      tripId,
      driverId: bestDriver.driverId,
      driverName: bestDriver.name,
      score: bestDriver.score,
    });
    return true;
  } catch (err: any) {
    logger.error("Auto-assign failed", { tripId, error: err.message });
    return false;
  }
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
