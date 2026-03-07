import { getDb } from "../db/index.js";
import { users, trips, driverStatus } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { assignTrip } from "./tripService.js";
import logger from "../lib/logger.js";

interface DriverCandidate {
  driverId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  activeTrips: number;
  score: number;
}

export async function findBestDriver(
  tenantId: string,
  pickupLat?: number,
  pickupLng?: number
): Promise<DriverCandidate | null> {
  const db = getDb();

  // Get available drivers with their status
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

  // Score each driver
  const candidates: DriverCandidate[] = [];

  for (const driver of availableDrivers) {
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
    let score = 100;

    // Penalize drivers with active trips
    score -= activeTrips * 30;

    // Bonus for proximity if we have coordinates
    if (pickupLat && pickupLng && driver.latitude && driver.longitude) {
      const distance = haversineDistance(
        pickupLat,
        pickupLng,
        Number(driver.latitude),
        Number(driver.longitude)
      );
      // Closer drivers score higher (max 50 bonus for <1 mile)
      score += Math.max(0, 50 - distance * 5);
    }

    // Penalize stale location (>10 min old)
    if (driver.lastLocationAt) {
      const ageMinutes = (Date.now() - driver.lastLocationAt.getTime()) / 60000;
      if (ageMinutes > 10) score -= 20;
      if (ageMinutes > 30) score -= 30;
    } else {
      score -= 20;
    }

    candidates.push({
      driverId: driver.driverId,
      name: `${driver.firstName} ${driver.lastName}`,
      latitude: driver.latitude ? Number(driver.latitude) : null,
      longitude: driver.longitude ? Number(driver.longitude) : null,
      activeTrips,
      score,
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  logger.info("Auto-assign candidates scored", {
    tenantId,
    candidates: candidates.map((c) => ({ name: c.name, score: c.score, activeTrips: c.activeTrips })),
  });

  return candidates[0] || null;
}

export async function autoAssignTrip(tripId: string, tenantId: string): Promise<boolean> {
  const bestDriver = await findBestDriver(tenantId);

  if (!bestDriver) {
    logger.warn("Auto-assign: no available drivers", { tripId, tenantId });
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

// Haversine formula for distance between two points (returns miles)
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
