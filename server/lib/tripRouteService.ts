import { db } from "../db";
import { trips, tripRoutes, tripEvents } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { buildRoute } from "./googleMaps";

export interface TripRouteResult {
  routePolyline: string;
  routeDistanceMeters: number;
  routeDurationSeconds: number;
  routeFingerprint: string;
  routeVersion: number;
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

export async function ensureTripRoute(tripId: number, reason?: string): Promise<TripRouteResult | null> {
  if (inFlightRoutes.has(tripId)) {
    return inFlightRoutes.get(tripId)!;
  }

  const promise = computeRoute(tripId, reason);
  inFlightRoutes.set(tripId, promise);

  try {
    return await promise;
  } finally {
    inFlightRoutes.delete(tripId);
  }
}

export async function computeRouteFromCoords(
  tripId: number,
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  reason: string = "reroute"
): Promise<TripRouteResult | null> {
  let route;
  try {
    route = await buildRoute(
      { lat: originLat, lng: originLng },
      { lat: destLat, lng: destLng }
    );
  } catch (err: any) {
    console.warn(`[TRIP-ROUTE] Reroute failed for trip ${tripId}: ${err.message}`);
    return null;
  }

  const distanceMeters = Math.round(route.totalMiles * 1609.344);
  const durationSeconds = Math.round(route.totalMinutes * 60);
  const fingerprint = buildFingerprint(originLat, originLng, destLat, destLng);

  const [trip] = await db.select({ routeVersion: trips.routeVersion }).from(trips).where(eq(trips.id, tripId));
  const currentVersion = trip?.routeVersion ?? 1;
  const newVersion = currentVersion + 1;

  await db.insert(tripRoutes).values({
    tripId,
    version: newVersion,
    polyline: route.polyline,
    distanceMeters,
    durationSeconds,
    provider: "google",
    reason,
    fingerprint,
  });

  await db.update(trips).set({
    routePolyline: route.polyline,
    routeDistanceMeters: distanceMeters,
    routeDurationSeconds: durationSeconds,
    routeFingerprint: fingerprint,
    routeProvider: "google",
    routeStatus: "computed",
    routeVersion: newVersion,
    routeUpdatedAt: new Date(),
    distanceMiles: String(route.totalMiles),
    durationMinutes: route.totalMinutes,
    updatedAt: new Date(),
  }).where(eq(trips.id, tripId));

  if (reason === "reroute") {
    await db.insert(tripEvents).values({
      tripId,
      eventType: "reroute",
      payload: { version: newVersion, originLat, originLng, destLat, destLng },
    });
  }

  recentComputeTimestamps.set(tripId, Date.now());

  return {
    routePolyline: route.polyline,
    routeDistanceMeters: distanceMeters,
    routeDurationSeconds: durationSeconds,
    routeFingerprint: fingerprint,
    routeVersion: newVersion,
  };
}

async function computeRoute(tripId: number, reason?: string): Promise<TripRouteResult | null> {
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

  if (trip.routePolyline && trip.routeFingerprint === fingerprint && trip.routeStatus === "computed") {
    return {
      routePolyline: trip.routePolyline,
      routeDistanceMeters: trip.routeDistanceMeters ?? 0,
      routeDurationSeconds: trip.routeDurationSeconds ?? 0,
      routeFingerprint: fingerprint,
      routeVersion: trip.routeVersion ?? 1,
    };
  }

  const lastCompute = recentComputeTimestamps.get(tripId);
  if (lastCompute && (Date.now() - lastCompute) < THROTTLE_TTL_MS && trip.routePolyline && trip.routeFingerprint === fingerprint) {
    return {
      routePolyline: trip.routePolyline,
      routeDistanceMeters: trip.routeDistanceMeters ?? 0,
      routeDurationSeconds: trip.routeDurationSeconds ?? 0,
      routeFingerprint: fingerprint,
      routeVersion: trip.routeVersion ?? 1,
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
    await db.update(trips).set({ routeStatus: "failed", routeUpdatedAt: new Date() }).where(eq(trips.id, tripId));
    return null;
  }

  const distanceMeters = Math.round(route.totalMiles * 1609.344);
  const durationSeconds = Math.round(route.totalMinutes * 60);

  const currentVersion = trip.routeVersion ?? 0;
  const newVersion = currentVersion + 1;
  const routeReason = reason || (currentVersion === 0 ? "initial" : "recompute");

  await db.insert(tripRoutes).values({
    tripId,
    version: newVersion,
    polyline: route.polyline,
    distanceMeters,
    durationSeconds,
    provider: "google",
    reason: routeReason,
    fingerprint,
  });

  await db.update(trips).set({
    routePolyline: route.polyline,
    routeDistanceMeters: distanceMeters,
    routeDurationSeconds: durationSeconds,
    routeFingerprint: fingerprint,
    routeProvider: "google",
    routeStatus: "computed",
    routeVersion: newVersion,
    routeUpdatedAt: new Date(),
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
    routeVersion: newVersion,
  };
}

export function ensureTripRouteNonBlocking(tripId: number, reason?: string): void {
  ensureTripRoute(tripId, reason).catch((err) => {
    console.warn(`[TRIP-ROUTE] Failed to compute route for trip ${tripId}: ${err.message}`);
  });
}

export async function getTripRouteHistory(tripId: number): Promise<any[]> {
  const routes = await db.select().from(tripRoutes)
    .where(eq(tripRoutes.tripId, tripId))
    .orderBy(desc(tripRoutes.version));
  return routes;
}
