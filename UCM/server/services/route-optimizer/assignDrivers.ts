import { db } from "../../db";
import { drivers, vehicles } from "@shared/schema";
import { eq, and, isNull, isNotNull } from "drizzle-orm";

interface AssignmentResult {
  driverId: number;
  vehicleId: number | null;
  driverName: string;
  distanceMiles: number | null;
}

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function assignDriver(
  centroidLat: number,
  centroidLng: number,
  cityId: number,
  excludeDriverIds: number[] = []
): Promise<AssignmentResult | null> {
  const availableDrivers = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      lastLat: drivers.lastLat,
      lastLng: drivers.lastLng,
      vehicleId: drivers.vehicleId,
      status: drivers.status,
      dispatchStatus: drivers.dispatchStatus,
    })
    .from(drivers)
    .where(
      and(
        eq(drivers.cityId, cityId),
        eq(drivers.status, "ACTIVE"),
        eq(drivers.active, true),
        isNull(drivers.deletedAt),
        isNotNull(drivers.vehicleId)
      )
    );

  const candidates = availableDrivers.filter(
    (d) =>
      d.lastLat != null &&
      d.lastLng != null &&
      !excludeDriverIds.includes(d.id)
  );

  if (candidates.length === 0) return null;

  let nearest = candidates[0];
  let nearestDist = Infinity;

  for (const d of candidates) {
    const dist = haversineDistance(
      centroidLat,
      centroidLng,
      d.lastLat!,
      d.lastLng!
    );
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = d;
    }
  }

  const MAX_RADIUS_MILES = 10;
  if (nearestDist > MAX_RADIUS_MILES) return null;

  return {
    driverId: nearest.id,
    vehicleId: nearest.vehicleId,
    driverName: `${nearest.firstName} ${nearest.lastName}`,
    distanceMiles: Math.round(nearestDist * 100) / 100,
  };
}
