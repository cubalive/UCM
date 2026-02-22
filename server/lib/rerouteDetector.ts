import { storage } from "../storage";
import { cache } from "./cache";
import { computeRouteFromCoords } from "./tripRouteService";

const OFF_ROUTE_THRESHOLD_METERS = 500;
const OFF_ROUTE_CONSECUTIVE_COUNT = 3;
const REROUTE_COOLDOWN_MS = 120_000;

const offRouteCounters = new Map<number, number>();
const rerouteTimestamps = new Map<number, number>();

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function distanceToPolyline(driverLat: number, driverLng: number, polylinePoints: Array<{ lat: number; lng: number }>): number {
  let minDist = Infinity;
  for (const point of polylinePoints) {
    const d = haversineDistance(driverLat, driverLng, point.lat, point.lng);
    if (d < minDist) minDist = d;
    if (d < 50) return d;
  }
  return minDist;
}

export async function evaluateReroute(driverId: number, lat: number, lng: number): Promise<void> {
  try {
    const activeTrips = await storage.getActiveTripsForDriver(driverId);
    if (!activeTrips || activeTrips.length === 0) return;

    const movingStatuses = ["EN_ROUTE_TO_PICKUP", "IN_PROGRESS", "EN_ROUTE_TO_DROPOFF"];

    for (const trip of activeTrips) {
      if (!movingStatuses.includes(trip.status)) continue;
      if (!trip.routePolyline) continue;

      const lastReroute = rerouteTimestamps.get(trip.id);
      if (lastReroute && (Date.now() - lastReroute) < REROUTE_COOLDOWN_MS) continue;

      const cacheKey = `trip:${trip.id}:polyline_decoded`;
      let polylinePoints = cache.get<Array<{ lat: number; lng: number }>>(cacheKey);
      if (!polylinePoints) {
        polylinePoints = decodePolyline(trip.routePolyline);
        const sampled = polylinePoints.length > 200
          ? polylinePoints.filter((_, i) => i % Math.ceil(polylinePoints!.length / 200) === 0)
          : polylinePoints;
        cache.set(cacheKey, sampled, 300_000);
        polylinePoints = sampled;
      }

      const distance = distanceToPolyline(lat, lng, polylinePoints);

      if (distance > OFF_ROUTE_THRESHOLD_METERS) {
        const count = (offRouteCounters.get(trip.id) || 0) + 1;
        offRouteCounters.set(trip.id, count);

        if (count >= OFF_ROUTE_CONSECUTIVE_COUNT) {
          offRouteCounters.delete(trip.id);
          rerouteTimestamps.set(trip.id, Date.now());

          const isPickupPhase = ["EN_ROUTE_TO_PICKUP"].includes(trip.status);
          const destLat = isPickupPhase ? Number(trip.pickupLat) : Number(trip.dropoffLat);
          const destLng = isPickupPhase ? Number(trip.pickupLng) : Number(trip.dropoffLng);

          if (!isNaN(destLat) && !isNaN(destLng)) {
            console.log(`[REROUTE] Trip ${trip.id}: driver ${driverId} off-route (${Math.round(distance)}m), recomputing...`);
            cache.set(cacheKey, null, 1);
            await computeRouteFromCoords(trip.id, lat, lng, destLat, destLng, "reroute");
          }
        }
      } else {
        offRouteCounters.delete(trip.id);
      }
    }
  } catch (err: any) {
    console.warn(`[REROUTE] Error evaluating reroute for driver ${driverId}: ${err.message}`);
  }
}
