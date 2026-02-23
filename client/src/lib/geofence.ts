const EARTH_RADIUS_M = 6371000;

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const DEFAULT_PICKUP_RADIUS_M = 150;
export const DEFAULT_DROPOFF_RADIUS_M = 160;
export const MANUAL_FALLBACK_RADIUS_M = 300;
export const GPS_FRESH_THRESHOLD_MS = 30_000;

export interface GeofenceResult {
  distanceMeters: number | null;
  withinRadius: boolean;
  withinFallbackRadius: boolean;
  gpsFresh: boolean;
  gpsFreshSeconds: number | null;
}

export function evaluatePickupGeofence(
  driverLat: number | null,
  driverLng: number | null,
  pickupLat: number | null,
  pickupLng: number | null,
  gpsTimestamp: number | null,
  radiusMeters: number = DEFAULT_PICKUP_RADIUS_M,
): GeofenceResult {
  const now = Date.now();
  const gpsFreshSeconds =
    gpsTimestamp != null ? Math.round((now - gpsTimestamp) / 1000) : null;
  const gpsFresh =
    gpsFreshSeconds != null &&
    gpsFreshSeconds * 1000 <= GPS_FRESH_THRESHOLD_MS;

  if (
    driverLat == null ||
    driverLng == null ||
    pickupLat == null ||
    pickupLng == null
  ) {
    return {
      distanceMeters: null,
      withinRadius: false,
      withinFallbackRadius: false,
      gpsFresh,
      gpsFreshSeconds,
    };
  }

  const dist = haversineMeters(driverLat, driverLng, pickupLat, pickupLng);

  return {
    distanceMeters: Math.round(dist),
    withinRadius: dist <= radiusMeters,
    withinFallbackRadius: dist <= MANUAL_FALLBACK_RADIUS_M,
    gpsFresh,
    gpsFreshSeconds,
  };
}

export function evaluateDropoffGeofence(
  driverLat: number | null,
  driverLng: number | null,
  dropoffLat: number | null,
  dropoffLng: number | null,
  gpsTimestamp: number | null,
  radiusMeters: number = DEFAULT_DROPOFF_RADIUS_M,
): GeofenceResult {
  const now = Date.now();
  const gpsFreshSeconds =
    gpsTimestamp != null ? Math.round((now - gpsTimestamp) / 1000) : null;
  const gpsFresh =
    gpsFreshSeconds != null &&
    gpsFreshSeconds * 1000 <= GPS_FRESH_THRESHOLD_MS;

  if (
    driverLat == null ||
    driverLng == null ||
    dropoffLat == null ||
    dropoffLng == null
  ) {
    return {
      distanceMeters: null,
      withinRadius: false,
      withinFallbackRadius: false,
      gpsFresh,
      gpsFreshSeconds,
    };
  }

  const dist = haversineMeters(driverLat, driverLng, dropoffLat, dropoffLng);

  return {
    distanceMeters: Math.round(dist),
    withinRadius: dist <= radiusMeters,
    withinFallbackRadius: dist <= MANUAL_FALLBACK_RADIUS_M,
    gpsFresh,
    gpsFreshSeconds,
  };
}

export function isArrivalGatedStatus(targetStatus: string): boolean {
  return targetStatus === "ARRIVED_PICKUP" || targetStatus === "ARRIVED_DROPOFF";
}

export function canAutoArrive(
  targetStatus: string,
  geofence: GeofenceResult,
): boolean {
  if (!isArrivalGatedStatus(targetStatus)) return true;
  return geofence.withinRadius && geofence.gpsFresh;
}

export function canManualArrive(
  targetStatus: string,
  geofence: GeofenceResult,
  dispatcherOverride: boolean = false,
): boolean {
  if (!isArrivalGatedStatus(targetStatus)) return true;
  if (dispatcherOverride) return true;
  return geofence.withinFallbackRadius;
}
