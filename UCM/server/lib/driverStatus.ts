import { storage } from "../storage";
import { cache, cacheKeys } from "./cache";

export type OperationalStatus = "AVAILABLE" | "BUSY" | "OFFLINE";

export interface DriverOperationalResult {
  status: OperationalStatus;
  activeTripId: number | null;
  activeTripStatus: string | null;
  activeTripPublicId: string | null;
  dispatchStatus: string | null;
  lastSeenAt: string | null;
  reservedTripId: number | null;
  reservedTripPublicId: string | null;
}

const ONLINE_CUTOFF_MS = 90_000;
const CACHE_TTL_MS = 15_000;

const ACTIVE_TRIP_STATUSES = new Set([
  "ASSIGNED",
  "EN_ROUTE_TO_PICKUP",
  "ARRIVED_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_TO_DROPOFF",
  "ARRIVED_DROPOFF",
  "IN_PROGRESS",
]);

const BUSY_TRIP_STATUSES = new Set([
  "EN_ROUTE_TO_PICKUP",
  "ARRIVED_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_TO_DROPOFF",
  "ARRIVED_DROPOFF",
  "IN_PROGRESS",
]);

export async function computeDriverOperationalStatus(driverId: number): Promise<DriverOperationalResult> {
  const cacheKey = `driver_op_status:${driverId}`;
  const cached = cache.get<DriverOperationalResult>(cacheKey);
  if (cached) return cached;

  const driver = await storage.getDriver(driverId);
  if (!driver) {
    return { status: "OFFLINE", activeTripId: null, activeTripStatus: null, activeTripPublicId: null, dispatchStatus: null, lastSeenAt: null };
  }

  const activeTrips = await storage.getActiveTripsForDriver(driverId);
  const busyTrip = activeTrips.find(t => BUSY_TRIP_STATUSES.has(t.status)) || null;
  const activeTrip = busyTrip || activeTrips.find(t => ACTIVE_TRIP_STATUSES.has(t.status)) || null;
  const reservedTrip = !busyTrip ? activeTrips.find(t => t.status === "ASSIGNED") || null : null;

  let status: OperationalStatus;

  if (busyTrip) {
    status = "BUSY";
  } else if (driver.dispatchStatus === "off") {
    status = "OFFLINE";
  } else if (!driver.lastSeenAt) {
    status = "OFFLINE";
  } else {
    const lastSeen = driver.lastSeenAt instanceof Date ? driver.lastSeenAt : new Date(String(driver.lastSeenAt));
    const elapsed = Date.now() - lastSeen.getTime();
    status = elapsed <= ONLINE_CUTOFF_MS ? "AVAILABLE" : "OFFLINE";
  }

  const lastSeenDate = driver.lastSeenAt
    ? (driver.lastSeenAt instanceof Date ? driver.lastSeenAt : new Date(String(driver.lastSeenAt)))
    : null;

  const displayTrip = busyTrip || activeTrip;

  const result: DriverOperationalResult = {
    status,
    activeTripId: displayTrip?.id || null,
    activeTripStatus: displayTrip?.status || null,
    activeTripPublicId: displayTrip?.publicId || null,
    dispatchStatus: driver.dispatchStatus,
    lastSeenAt: lastSeenDate ? lastSeenDate.toISOString() : null,
    reservedTripId: reservedTrip?.id || null,
    reservedTripPublicId: reservedTrip?.publicId || null,
  };

  cache.set(cacheKey, result, CACHE_TTL_MS);
  return result;
}

export async function computeBulkDriverStatus(driverIds: number[]): Promise<Map<number, DriverOperationalResult>> {
  const results = new Map<number, DriverOperationalResult>();
  const uncached: number[] = [];

  for (const id of driverIds) {
    const cacheKey = `driver_op_status:${id}`;
    const cached = cache.get<DriverOperationalResult>(cacheKey);
    if (cached) {
      results.set(id, cached);
    } else {
      uncached.push(id);
    }
  }

  if (uncached.length > 0) {
    const promises = uncached.map(id => computeDriverOperationalStatus(id).then(r => ({ id, r })));
    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      if (s.status === "fulfilled") {
        results.set(s.value.id, s.value.r);
      }
    }
  }

  return results;
}

export function invalidateDriverStatusCache(driverId: number): void {
  cache.delete(`driver_op_status:${driverId}`);
}
