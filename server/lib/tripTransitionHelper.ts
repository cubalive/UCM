import { db } from "../db";
import { trips, drivers } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { storage } from "../storage";
import { VALID_TRANSITIONS, STATUS_TIMESTAMP_MAP } from "@shared/tripStateMachine";
import { broadcastToTrip } from "./realtime";
import { broadcastTripSupabase } from "./supabaseRealtime";

const ACTIVE_TRIP_STATUSES = [
  "EN_ROUTE_TO_PICKUP",
  "ARRIVED_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_TO_DROPOFF",
  "IN_PROGRESS",
  "ARRIVED_DROPOFF",
];

const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"];

export interface TransitionResult {
  success: boolean;
  trip: any;
  previousStatus: string;
  error?: string;
}

export async function transitionTripStatus(
  tripId: number,
  nextStatus: string,
  actor: { userId: number; role: string; source?: string },
  options?: {
    skipGeofenceCheck?: boolean;
    additionalData?: Record<string, any>;
  }
): Promise<TransitionResult> {
  const trip = await storage.getTrip(tripId);
  if (!trip) {
    return { success: false, trip: null, previousStatus: "", error: "Trip not found" };
  }

  if (trip.status === nextStatus) {
    return { success: true, trip, previousStatus: trip.status };
  }

  const allowedNext = VALID_TRANSITIONS[trip.status] || [];
  if (!allowedNext.includes(nextStatus)) {
    return {
      success: false,
      trip,
      previousStatus: trip.status,
      error: `Invalid transition from ${trip.status} to ${nextStatus}`,
    };
  }

  const ARRIVAL_STATUSES = ["ARRIVED_PICKUP", "ARRIVED_DROPOFF"];
  if (ARRIVAL_STATUSES.includes(nextStatus) && !options?.skipGeofenceCheck) {
    const dispatchRoles = ["SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"];
    const isDispatchOverride = dispatchRoles.includes(actor.role) || actor.source === "geofence_auto";

    if (!isDispatchOverride && trip.driverId) {
      const driver = await storage.getDriver(trip.driverId);
      if (driver?.lastLat && driver?.lastLng) {
        const isPickup = nextStatus === "ARRIVED_PICKUP";
        const targetLat = isPickup ? Number(trip.pickupLat || 0) : Number(trip.dropoffLat || 0);
        const targetLng = isPickup ? Number(trip.pickupLng || 0) : Number(trip.dropoffLng || 0);

        if (targetLat && targetLng) {
          const ENV_PICKUP_RADIUS = parseInt(process.env.GEOFENCE_PICKUP_RADIUS_METERS || "120");
          const ENV_DROPOFF_RADIUS = parseInt(process.env.GEOFENCE_DROPOFF_RADIUS_METERS || "160");
          const FALLBACK_RADIUS = parseInt(process.env.GEOFENCE_FALLBACK_RADIUS_METERS || "300");
          const GPS_ACCURACY_THRESHOLD = parseInt(process.env.GEOFENCE_ACCURACY_THRESHOLD_METERS || "100");
          const radius = isPickup
            ? ((trip as any).pickupGeofenceM ?? ENV_PICKUP_RADIUS)
            : ((trip as any).dropoffGeofenceM ?? ENV_DROPOFF_RADIUS);

          const driverAccuracy = Number((driver as any).lastAccuracy || 0);
          const overrideReason = options?.additionalData?.geofenceOverrideReason;

          if (driverAccuracy > GPS_ACCURACY_THRESHOLD && driverAccuracy > 0 && !overrideReason) {
            return {
              success: false,
              trip,
              previousStatus: trip.status,
              error: `GPS accuracy too low (${Math.round(driverAccuracy)}m, threshold: ${GPS_ACCURACY_THRESHOLD}m). Move to an open area or wait for better signal. Use manual override if needed.`,
            };
          }

          const R = 6371000;
          const dLat = ((targetLat - Number(driver.lastLat)) * Math.PI) / 180;
          const dLng = ((targetLng - Number(driver.lastLng)) * Math.PI) / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos((Number(driver.lastLat) * Math.PI) / 180) *
            Math.cos((targetLat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
          const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

          if (dist > radius && dist > FALLBACK_RADIUS && !overrideReason) {
            return {
              success: false,
              trip,
              previousStatus: trip.status,
              error: `Too far from ${isPickup ? "pickup" : "dropoff"} (${Math.round(dist)}m away, radius: ${radius}m). Use manual override if you are at the location.`,
            };
          }

          if ((dist > radius || driverAccuracy > GPS_ACCURACY_THRESHOLD) && overrideReason) {
            try {
              await storage.createAuditLog({
                userId: actor.userId,
                action: "GEOFENCE_OVERRIDE",
                entity: "trip",
                entityId: tripId,
                details: `Manual arrival override at ${Math.round(dist)}m (radius: ${radius}m, accuracy: ${Math.round(driverAccuracy)}m). Reason: ${overrideReason}`,
              });
            } catch {}
          }
        }
      }
    }
  }

  const timestampField = STATUS_TIMESTAMP_MAP[nextStatus];
  const updateData: any = { status: nextStatus };
  if (timestampField) {
    updateData[timestampField] = new Date();
  }

  if (nextStatus === "ARRIVED_PICKUP") {
    try {
      const { companySettings } = await import("@shared/schema");
      const [cs] = await db.select().from(companySettings).where(eq(companySettings.companyId, trip.companyId));
      const waitCfg = (cs?.driverV3 as any)?.waiting;
      const waitMinutes = waitCfg?.minutes ?? 10;
      updateData.waitingStartedAt = new Date();
      updateData.waitingMinutes = waitMinutes;
      updateData.waitingEndedAt = null;
      updateData.waitingReason = null;
      updateData.waitingOverride = false;
      updateData.waitingExtendCount = 0;
    } catch {}
  }

  if (options?.additionalData) {
    Object.assign(updateData, options.additionalData);
  }

  const previousStatus = trip.status;
  const updated = await db
    .update(trips)
    .set(updateData)
    .where(and(eq(trips.id, tripId), eq(trips.status, previousStatus)))
    .returning();

  if (!updated.length) {
    return { success: false, trip, previousStatus, error: "Concurrent update detected" };
  }

  const updatedTrip = updated[0];

  try {
    let driverLat: number | null = null;
    let driverLng: number | null = null;
    let withinGeofence: boolean | null = null;
    let geofenceType: "pickup" | "dropoff" | null = null;
    let geofenceDistanceM: number | null = null;

    if (updatedTrip.driverId) {
      try {
        const { getDriverLocationFromCache } = await import("./driverLocationIngest");
        const loc = getDriverLocationFromCache(updatedTrip.driverId);
        if (loc) {
          driverLat = loc.lat;
          driverLng = loc.lng;
        }
      } catch {}
    }

    if (nextStatus === "ARRIVED_PICKUP" || nextStatus === "ARRIVED_DROPOFF") {
      const isPickup = nextStatus === "ARRIVED_PICKUP";
      geofenceType = isPickup ? "pickup" : "dropoff";
      const targetLat = isPickup ? Number(updatedTrip.pickupLat || 0) : Number(updatedTrip.dropoffLat || 0);
      const targetLng = isPickup ? Number(updatedTrip.pickupLng || 0) : Number(updatedTrip.dropoffLng || 0);
      if (driverLat && driverLng && targetLat && targetLng) {
        const R = 6371000;
        const dLat = ((targetLat - driverLat) * Math.PI) / 180;
        const dLng = ((targetLng - driverLng) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos((driverLat * Math.PI) / 180) * Math.cos((targetLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
        geofenceDistanceM = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
        const radius = isPickup ? (updatedTrip.pickupGeofenceM ?? 150) : (updatedTrip.dropoffGeofenceM ?? 150);
        withinGeofence = geofenceDistanceM <= radius;
      }
    }

    const timelineEntry = {
      ts: new Date().toISOString(),
      status: nextStatus,
      previousStatus,
      actorRole: actor.role,
      actorId: actor.userId,
      source: actor.source || "manual",
      lat: driverLat,
      lng: driverLng,
      withinGeofence,
      geofenceType,
      geofenceDistanceM,
    };

    await db.update(trips).set({
      timeline: sql`COALESCE(${trips.timeline}, '[]'::jsonb) || ${JSON.stringify([timelineEntry])}::jsonb`,
    }).where(eq(trips.id, tripId));
  } catch (err: any) {
    console.warn(`[TIMELINE] Failed to record timeline for trip ${tripId}: ${err.message}`);
  }

  if (updatedTrip.driverId) {
    try {
      if (ACTIVE_TRIP_STATUSES.includes(nextStatus)) {
        await db.update(drivers).set({ dispatchStatus: "enroute" }).where(eq(drivers.id, updatedTrip.driverId));
      } else if (TERMINAL_STATUSES.includes(nextStatus)) {
        await db.update(drivers).set({ dispatchStatus: "available" }).where(eq(drivers.id, updatedTrip.driverId));
      }
    } catch (err: any) {
      console.error(`[TRANSITION] Failed to update driver ${updatedTrip.driverId} dispatch status:`, err.message);
    }

    try {
      const { invalidateDriverStatusCache } = await import("./driverStatus");
      invalidateDriverStatusCache(updatedTrip.driverId);
    } catch {}
  }

  const broadcastPayload = {
    type: "status_change" as const,
    data: {
      tripId,
      status: nextStatus,
      previousStatus,
      driverId: updatedTrip.driverId,
      companyId: updatedTrip.companyId,
      clinicId: updatedTrip.clinicId,
      cityId: updatedTrip.cityId,
      timestamps: {
        startedAt: updatedTrip.startedAt,
        arrivedPickupAt: updatedTrip.arrivedPickupAt,
        pickedUpAt: updatedTrip.pickedUpAt,
        arrivedDropoffAt: updatedTrip.arrivedDropoffAt,
        completedAt: updatedTrip.completedAt,
      },
    },
  };

  try { broadcastToTrip(tripId, broadcastPayload); } catch {}
  try { await broadcastTripSupabase(tripId, broadcastPayload); } catch {}

  try {
    const { emitEvent } = await import("./eventBus");
    const eventPayload: Record<string, any> = {
      tripId,
      from: previousStatus,
      to: nextStatus,
      driverId: updatedTrip.driverId,
      companyId: updatedTrip.companyId,
      clinicId: updatedTrip.clinicId,
      cityId: updatedTrip.cityId,
      ts: Date.now(),
    };
    if (nextStatus === "ASSIGNED" && updatedTrip.driverId) {
      eventPayload.vehicleId = updatedTrip.vehicleId;
      eventPayload.pickupLat = updatedTrip.pickupLat;
      eventPayload.pickupLng = updatedTrip.pickupLng;
      eventPayload.dropoffLat = updatedTrip.dropoffLat;
      eventPayload.dropoffLng = updatedTrip.dropoffLng;
      await emitEvent("trip.assigned", eventPayload, `trip.assigned:${tripId}:${updatedTrip.driverId}`);
    }
    await emitEvent("trip.status_changed", eventPayload, `trip.status:${tripId}:${previousStatus}:${nextStatus}:${Date.now()}`);
  } catch {}

  broadcastCompanyTripUpdate(updatedTrip.companyId, {
    tripId,
    status: nextStatus,
    previousStatus,
    driverId: updatedTrip.driverId,
    clinicId: updatedTrip.clinicId,
    cityId: updatedTrip.cityId,
    publicId: updatedTrip.publicId,
  });

  // Broadcast to pharmacy portal if this trip originated from a pharmacy order
  if (updatedTrip.requestSource === "pharmacy") {
    try {
      const { pharmacyOrders } = await import("@shared/schema");
      const [order] = await db.select().from(pharmacyOrders)
        .where(eq(pharmacyOrders.tripId, tripId))
        .limit(1);
      if (order?.pharmacyId) {
        broadcastPharmacyOrderUpdate(order.pharmacyId, {
          type: "trip_status_change",
          orderId: order.id,
          tripId,
          status: nextStatus,
          previousStatus,
          driverId: updatedTrip.driverId,
        });
      }
    } catch {}
  }

  // Broadcast to broker portal if this trip originated from a broker request
  if (updatedTrip.requestSource === "broker") {
    try {
      const { brokerTripRequests } = await import("@shared/schema");
      const [request] = await db.select().from(brokerTripRequests)
        .where(eq(brokerTripRequests.tripId, tripId))
        .limit(1);
      if (request?.brokerId) {
        broadcastBrokerTripUpdate(request.brokerId, {
          type: "trip_status_change",
          requestId: request.id,
          tripId,
          status: nextStatus,
          previousStatus,
          driverId: updatedTrip.driverId,
        });
      }
    } catch {}
  }

  if (updatedTrip.driverId && ["ARRIVED_PICKUP", "PICKED_UP", "ARRIVED_DROPOFF", "EN_ROUTE_TO_DROPOFF"].includes(nextStatus)) {
    try {
      const { persistOnStatusEvent, getDriverLocationFromCache } = await import("./driverLocationIngest");
      const loc = getDriverLocationFromCache(updatedTrip.driverId);
      if (loc) {
        persistOnStatusEvent(updatedTrip.driverId, loc.lat, loc.lng);
      }
    } catch {}
  }

  const smsBaseUrl = process.env.PUBLIC_BASE_URL_APP
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://app.unitedcaremobility.com");

  try {
    const { autoNotifyPatient } = await import("./dispatchAutoSms");
    if (nextStatus === "EN_ROUTE_TO_PICKUP") await autoNotifyPatient(tripId, "en_route", { base_url: smsBaseUrl });
    if (nextStatus === "ARRIVED_PICKUP") await autoNotifyPatient(tripId, "arrived");
    if (nextStatus === "PICKED_UP") await autoNotifyPatient(tripId, "picked_up");
    if (nextStatus === "CANCELLED") await autoNotifyPatient(tripId, "canceled");
    if (nextStatus === "COMPLETED") await autoNotifyPatient(tripId, "completed");
  } catch {}

  if (nextStatus === "COMPLETED") {
    import("./gpsPingQuality").then(({ saveTripPingQuality }) => {
      saveTripPingQuality(tripId).catch(err => {
        console.warn(`[GPS-QUALITY] Failed to compute for trip ${tripId}: ${err.message}`);
      });
    }).catch(() => {});
  }

  // When a trip is cancelled and had a driver, suggest reassignment alternatives
  if (nextStatus === "CANCELLED" && updatedTrip.driverId) {
    try {
      const { autoReassignIfConfigured } = await import("./reassignmentEngine");
      autoReassignIfConfigured(tripId).catch((err: any) => {
        console.warn(`[TRANSITION] Reassignment suggestion failed for trip ${tripId}:`, err.message);
      });
    } catch (err: any) {
      console.warn(`[TRANSITION] Failed to load reassignment engine:`, err.message);
    }
  }

  if (TERMINAL_STATUSES.includes(nextStatus)) {
    storage.revokeTokensForTrip(tripId).catch(() => {});

    if (!updatedTrip.billingOutcome) {
      try {
        const { autoBillingClassify } = await import("./clinicBillingRoutes");
        await autoBillingClassify(updatedTrip);
      } catch {}
    }

    if (nextStatus === "COMPLETED") {
      try {
        const { finalizeTripRoute } = await import("./tripFinalizationService");
        await finalizeTripRoute(tripId);
      } catch (err: any) {
        console.warn("[TRANSITION] Trip finalization failed:", err.message);
      }

      try {
        const { computeActualDistance } = await import("./actualMilesService");
        await computeActualDistance(tripId);
      } catch (err: any) {
        console.warn("[TRANSITION] Actual distance computation failed:", err.message);
      }
    }

    if (nextStatus === "COMPLETED" && updatedTrip.clinicId) {
      try {
        const { computeTripBilling } = await import("./clinicBillingRoutes");
        await computeTripBilling(tripId);
      } catch {}

      try {
        const { processTripFinancials } = await import("../services/financialEngine");
        await processTripFinancials(tripId);
      } catch (err: any) {
        console.error("[TRANSITION] Financial engine failed for trip", tripId, err.message);
      }
    }

    try {
      const { computeTripModifiers } = await import("../services/payroll/modifiersEngine");
      const adjustments = await computeTripModifiers(tripId);
      if (adjustments.length > 0 && updatedTrip.driverId) {
        broadcastCompanyTripUpdate(updatedTrip.companyId, {
          tripId,
          type: "EARNINGS_UPDATED",
          driverId: updatedTrip.driverId,
          adjustments: adjustments.map(a => ({ type: a.type, amountCents: a.amountCents })),
        });
      }
    } catch (err: any) {
      console.error("[TRANSITION] Modifiers computation failed:", err.message);
    }
  }

  await storage.createAuditLog({
    userId: actor.userId,
    action: "UPDATE_STATUS",
    entity: "trip",
    entityId: tripId,
    details: JSON.stringify({
      oldStatus: previousStatus,
      newStatus: nextStatus,
      role: actor.role,
      source: actor.source || "manual",
      driverId: updatedTrip.driverId,
      patientId: updatedTrip.patientId,
      clinicId: updatedTrip.clinicId,
    }),
    cityId: updatedTrip.cityId,
  }).catch(() => {});

  return { success: true, trip: updatedTrip, previousStatus };
}

const companyChannelSubscriptions = new Map<number, Set<import("ws").WebSocket>>();
const clinicChannelSubscriptions = new Map<number, Set<import("ws").WebSocket>>();
const pharmacyChannelSubscriptions = new Map<number, Set<import("ws").WebSocket>>();
const brokerChannelSubscriptions = new Map<number, Set<import("ws").WebSocket>>();

export function subscribeToCompanyChannel(ws: import("ws").WebSocket, companyId: number): void {
  let subs = companyChannelSubscriptions.get(companyId);
  if (!subs) {
    subs = new Set();
    companyChannelSubscriptions.set(companyId, subs);
  }
  subs.add(ws);
}

export function unsubscribeFromCompanyChannel(ws: import("ws").WebSocket, companyId: number): void {
  const subs = companyChannelSubscriptions.get(companyId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) companyChannelSubscriptions.delete(companyId);
  }
}

export function subscribeToClinicChannel(ws: import("ws").WebSocket, clinicId: number): void {
  let subs = clinicChannelSubscriptions.get(clinicId);
  if (!subs) {
    subs = new Set();
    clinicChannelSubscriptions.set(clinicId, subs);
  }
  subs.add(ws);
}

export function unsubscribeFromClinicChannel(ws: import("ws").WebSocket, clinicId: number): void {
  const subs = clinicChannelSubscriptions.get(clinicId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) clinicChannelSubscriptions.delete(clinicId);
  }
}

export function broadcastCompanyTripUpdate(companyId: number, data: any): void {
  const subs = companyChannelSubscriptions.get(companyId);
  if (!subs || subs.size === 0) return;

  const { WebSocket } = require("ws");
  const payload = JSON.stringify({ type: "trip_update", companyId, data, ts: Date.now() });
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      subs.delete(ws);
    }
  }
  if (subs.size === 0) companyChannelSubscriptions.delete(companyId);

  if (data.clinicId) {
    broadcastClinicTripUpdate(data.clinicId, data);
  }
}

export function broadcastClinicTripUpdate(clinicId: number, data: any): void {
  const subs = clinicChannelSubscriptions.get(clinicId);
  if (!subs || subs.size === 0) return;

  const { WebSocket } = require("ws");
  const payload = JSON.stringify({ type: "trip_update", clinicId, data, ts: Date.now() });
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      subs.delete(ws);
    }
  }
  if (subs.size === 0) clinicChannelSubscriptions.delete(clinicId);
}

// ─── Pharmacy Channel ─────────────────────────────────────────────────────

export function subscribeToPharmacyChannel(ws: import("ws").WebSocket, pharmacyId: number): void {
  let subs = pharmacyChannelSubscriptions.get(pharmacyId);
  if (!subs) {
    subs = new Set();
    pharmacyChannelSubscriptions.set(pharmacyId, subs);
  }
  subs.add(ws);
}

export function unsubscribeFromPharmacyChannel(ws: import("ws").WebSocket, pharmacyId: number): void {
  const subs = pharmacyChannelSubscriptions.get(pharmacyId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) pharmacyChannelSubscriptions.delete(pharmacyId);
  }
}

export function broadcastPharmacyOrderUpdate(pharmacyId: number, data: any): void {
  const subs = pharmacyChannelSubscriptions.get(pharmacyId);
  if (!subs || subs.size === 0) return;

  const { WebSocket } = require("ws");
  const payload = JSON.stringify({ type: "order_update", pharmacyId, data, ts: Date.now() });
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      subs.delete(ws);
    }
  }
  if (subs.size === 0) pharmacyChannelSubscriptions.delete(pharmacyId);
}

// ─── Broker Channel ───────────────────────────────────────────────────────

export function subscribeToBrokerChannel(ws: import("ws").WebSocket, brokerId: number): void {
  let subs = brokerChannelSubscriptions.get(brokerId);
  if (!subs) {
    subs = new Set();
    brokerChannelSubscriptions.set(brokerId, subs);
  }
  subs.add(ws);
}

export function unsubscribeFromBrokerChannel(ws: import("ws").WebSocket, brokerId: number): void {
  const subs = brokerChannelSubscriptions.get(brokerId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) brokerChannelSubscriptions.delete(brokerId);
  }
}

export function broadcastBrokerTripUpdate(brokerId: number, data: any): void {
  const subs = brokerChannelSubscriptions.get(brokerId);
  if (!subs || subs.size === 0) return;

  const { WebSocket } = require("ws");
  const payload = JSON.stringify({ type: "broker_update", brokerId, data, ts: Date.now() });
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      subs.delete(ws);
    }
  }
  if (subs.size === 0) brokerChannelSubscriptions.delete(brokerId);
}

export function cleanupChannelSubscriptions(ws: import("ws").WebSocket): void {
  for (const [companyId, subs] of companyChannelSubscriptions) {
    subs.delete(ws);
    if (subs.size === 0) companyChannelSubscriptions.delete(companyId);
  }
  for (const [clinicId, subs] of clinicChannelSubscriptions) {
    subs.delete(ws);
    if (subs.size === 0) clinicChannelSubscriptions.delete(clinicId);
  }
  for (const [pharmacyId, subs] of pharmacyChannelSubscriptions) {
    subs.delete(ws);
    if (subs.size === 0) pharmacyChannelSubscriptions.delete(pharmacyId);
  }
  for (const [brokerId, subs] of brokerChannelSubscriptions) {
    subs.delete(ws);
    if (subs.size === 0) brokerChannelSubscriptions.delete(brokerId);
  }
}

export function getCompanyChannelCount(): number {
  let total = 0;
  for (const subs of companyChannelSubscriptions.values()) total += subs.size;
  return total;
}

export function getClinicChannelCount(): number {
  let total = 0;
  for (const subs of clinicChannelSubscriptions.values()) total += subs.size;
  return total;
}

export function getPharmacyChannelCount(): number {
  let total = 0;
  for (const subs of pharmacyChannelSubscriptions.values()) total += subs.size;
  return total;
}

export function getBrokerChannelCount(): number {
  let total = 0;
  for (const subs of brokerChannelSubscriptions.values()) total += subs.size;
  return total;
}

export const BUSY_TRIP_STATUSES = ACTIVE_TRIP_STATUSES;
