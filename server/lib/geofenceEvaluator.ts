import { db } from "../db";
import { trips } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { storage } from "../storage";
import { cache, cacheKeys } from "./cache";

const PICKUP_RADIUS_M = parseInt(process.env.GEOFENCE_PICKUP_RADIUS_METERS || "120");
const DROPOFF_RADIUS_M = parseInt(process.env.GEOFENCE_DROPOFF_RADIUS_METERS || "160");
const ENABLED = process.env.GEOFENCE_ENABLED === "true";

const COOLDOWN_MS = 30_000;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function evaluateGeofence(driverId: number, lat: number, lng: number): Promise<void> {
  if (!ENABLED) return;

  const cooldownKey = `geofence_cooldown:${driverId}`;
  const lastCheck = cache.get<number>(cooldownKey);
  if (lastCheck && Date.now() - lastCheck < COOLDOWN_MS) return;
  cache.set(cooldownKey, Date.now(), COOLDOWN_MS);

  try {
    const activeTrips = await storage.getActiveTripsForDriver(driverId);

    for (const trip of activeTrips) {
      if (trip.status === "EN_ROUTE_TO_PICKUP" && trip.pickupLat && trip.pickupLng) {
        const dist = haversineMeters(lat, lng, trip.pickupLat, trip.pickupLng);
        if (dist <= PICKUP_RADIUS_M) {
          const transitionKey = `geofence_transition:${trip.id}:ARRIVED_PICKUP`;
          if (cache.get(transitionKey)) continue;
          cache.set(transitionKey, true, 300_000);

          console.log(`[GEOFENCE] Driver ${driverId} entered pickup radius (${Math.round(dist)}m) for trip ${trip.id}, auto-transitioning to ARRIVED_PICKUP`);

          await db.update(trips).set({
            status: "ARRIVED_PICKUP",
            arrivedPickupAt: new Date(),
          }).where(
            and(
              eq(trips.id, trip.id),
              eq(trips.status, "EN_ROUTE_TO_PICKUP")
            )
          );

          import("./realtime").then(({ broadcastToTrip }) => {
            broadcastToTrip(trip.id, { type: "status_change", data: { status: "ARRIVED_PICKUP", tripId: trip.id } });
          }).catch(() => {});

          import("./supabaseRealtime").then(({ broadcastTripSupabase }) => {
            broadcastTripSupabase(trip.id, { type: "status_change", data: { status: "ARRIVED_PICKUP", tripId: trip.id } });
          }).catch(() => {});

          import("./dispatchAutoSms").then(({ autoNotifyPatient }) => {
            autoNotifyPatient(trip.id, "arrived");
          }).catch(() => {});

          storage.createAuditLog({
            userId: 0,
            action: "GEOFENCE_AUTO_TRANSITION",
            entity: "trip",
            entityId: trip.id,
            details: JSON.stringify({
              oldStatus: "EN_ROUTE_TO_PICKUP",
              newStatus: "ARRIVED_PICKUP",
              distanceMeters: Math.round(dist),
              radiusMeters: PICKUP_RADIUS_M,
              driverLat: lat,
              driverLng: lng,
            }),
            cityId: trip.cityId,
          }).catch(() => {});
        }
      }

      if (trip.status === "EN_ROUTE_TO_DROPOFF" && trip.dropoffLat && trip.dropoffLng) {
        const dist = haversineMeters(lat, lng, trip.dropoffLat, trip.dropoffLng);
        if (dist <= DROPOFF_RADIUS_M) {
          const transitionKey = `geofence_transition:${trip.id}:ARRIVED_DROPOFF`;
          if (cache.get(transitionKey)) continue;
          cache.set(transitionKey, true, 300_000);

          console.log(`[GEOFENCE] Driver ${driverId} entered dropoff radius (${Math.round(dist)}m) for trip ${trip.id}, auto-transitioning to ARRIVED_DROPOFF`);

          await db.update(trips).set({
            status: "ARRIVED_DROPOFF",
            arrivedDropoffAt: new Date(),
          }).where(
            and(
              eq(trips.id, trip.id),
              eq(trips.status, "EN_ROUTE_TO_DROPOFF")
            )
          );

          import("./realtime").then(({ broadcastToTrip }) => {
            broadcastToTrip(trip.id, { type: "status_change", data: { status: "ARRIVED_DROPOFF", tripId: trip.id } });
          }).catch(() => {});

          import("./supabaseRealtime").then(({ broadcastTripSupabase }) => {
            broadcastTripSupabase(trip.id, { type: "status_change", data: { status: "ARRIVED_DROPOFF", tripId: trip.id } });
          }).catch(() => {});

          storage.createAuditLog({
            userId: 0,
            action: "GEOFENCE_AUTO_TRANSITION",
            entity: "trip",
            entityId: trip.id,
            details: JSON.stringify({
              oldStatus: "EN_ROUTE_TO_DROPOFF",
              newStatus: "ARRIVED_DROPOFF",
              distanceMeters: Math.round(dist),
              radiusMeters: DROPOFF_RADIUS_M,
              driverLat: lat,
              driverLng: lng,
            }),
            cityId: trip.cityId,
          }).catch(() => {});
        }
      }
    }
  } catch (err: any) {
    console.error(`[GEOFENCE] Error evaluating driver ${driverId}:`, err.message);
  }
}
