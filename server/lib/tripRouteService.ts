import { db } from "../db";
import { trips } from "@shared/schema";
import { eq } from "drizzle-orm";
import { buildRoute } from "./googleMaps";

interface TripRouteResult {
  routePolyline: string;
  routeDistanceMeters: number;
  routeDurationSeconds: number;
  routeFingerprint: string;
}

const inFlightRoutes = new Map<number, Promise<TripRouteResult | null>>();

const recentComputeTimestamps = new Map<number, number>();
const THROTTLE_TTL_MS = 10 * 60 * 1000;

function buildFingerprint(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): string {
  return `${pickupLat},${pickupLng}|${dropoffLat},${dropoffLng}`;
}

export async function ensureTripRoute(tripId: number): Promise<TripRouteResult | null> {
  if (inFlightRoutes.has(tripId)) {
    return inFlightRoutes.get(tripId)!;
  }

  const promise = computeRoute(tripId);
  inFlightRoutes.set(tripId, promise);

  try {
    return await promise;
  } finally {
    inFlightRoutes.delete(tripId);
  }
}

async function computeRoute(tripId: number): Promise<TripRouteResult | null> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) return null;

  const pickupLat = trip.pickupLat != null ? Number(trip.pickupLat) : null;
  const pickupLng = trip.pickupLng != null ? Number(trip.pickupLng) : null;
  const dropoffLat = trip.dropoffLat != null ? Number(trip.dropoffLat) : null;
  const dropoffLng = trip.dropoffLng != null ? Number(trip.dropoffLng) : null;

  if (pickupLat === null || isNaN(pickupLat) || pickupLng === null || isNaN(pickupLng) ||
      dropoffLat === null || isNaN(dropoffLat) || dropoffLng === null || isNaN(dropoffLng)) {
    return null;
  }

  const fingerprint = buildFingerprint(pickupLat, pickupLng, dropoffLat, dropoffLng);

  if (trip.routePolyline && trip.routeFingerprint === fingerprint) {
    return {
      routePolyline: trip.routePolyline,
      routeDistanceMeters: trip.routeDistanceMeters ?? 0,
      routeDurationSeconds: trip.routeDurationSeconds ?? 0,
      routeFingerprint: fingerprint,
    };
  }

  const lastCompute = recentComputeTimestamps.get(tripId);
  if (lastCompute && (Date.now() - lastCompute) < THROTTLE_TTL_MS && trip.routePolyline && trip.routeFingerprint === fingerprint) {
    return {
      routePolyline: trip.routePolyline,
      routeDistanceMeters: trip.routeDistanceMeters ?? 0,
      routeDurationSeconds: trip.routeDurationSeconds ?? 0,
      routeFingerprint: fingerprint,
    };
  }

  let route;
  try {
    route = await buildRoute(
      { lat: pickupLat, lng: pickupLng },
      { lat: dropoffLat, lng: dropoffLng }
    );
  } catch (err: any) {
    console.warn(`[TRIP-ROUTE] Google Directions API failed for trip ${tripId}: ${err.message}`);
    return null;
  }

  const distanceMeters = Math.round(route.totalMiles * 1609.344);
  const durationSeconds = Math.round(route.totalMinutes * 60);

  await db.update(trips).set({
    routePolyline: route.polyline,
    routeDistanceMeters: distanceMeters,
    routeDurationSeconds: durationSeconds,
    routeFingerprint: fingerprint,
    distanceMiles: String(route.totalMiles),
    durationMinutes: route.totalMinutes,
    updatedAt: new Date(),
  }).where(eq(trips.id, tripId));

  recentComputeTimestamps.set(tripId, Date.now());

  if (recentComputeTimestamps.size > 5000) {
    const cutoff = Date.now() - THROTTLE_TTL_MS;
    for (const [id, ts] of recentComputeTimestamps) {
      if (ts < cutoff) recentComputeTimestamps.delete(id);
    }
  }

  return {
    routePolyline: route.polyline,
    routeDistanceMeters: distanceMeters,
    routeDurationSeconds: durationSeconds,
    routeFingerprint: fingerprint,
  };
}

export function ensureTripRouteNonBlocking(tripId: number): void {
  ensureTripRoute(tripId).catch((err) => {
    console.warn(`[TRIP-ROUTE] Failed to compute route for trip ${tripId}: ${err.message}`);
  });
}
