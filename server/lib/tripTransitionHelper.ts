import { db } from "../db";
import { trips, drivers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { storage } from "../storage";
import { VALID_TRANSITIONS, STATUS_TIMESTAMP_MAP } from "@shared/tripStateMachine";
import { broadcastToTrip } from "./realtime";
import { broadcastTripSupabase } from "./supabaseRealtime";

const ACTIVE_TRIP_STATUSES = [
  "ASSIGNED",
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

  broadcastCompanyTripUpdate(updatedTrip.companyId, {
    tripId,
    status: nextStatus,
    previousStatus,
    driverId: updatedTrip.driverId,
    clinicId: updatedTrip.clinicId,
    cityId: updatedTrip.cityId,
    publicId: updatedTrip.publicId,
  });

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

  if (TERMINAL_STATUSES.includes(nextStatus)) {
    storage.revokeTokensForTrip(tripId).catch(() => {});

    if (!updatedTrip.billingOutcome) {
      try {
        const { autoBillingClassify } = await import("./clinicBillingRoutes");
        await autoBillingClassify(updatedTrip);
      } catch {}
    }

    if (nextStatus === "COMPLETED" && updatedTrip.clinicId) {
      try {
        const { computeTripBilling } = await import("./clinicBillingRoutes");
        await computeTripBilling(tripId);
      } catch {}
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

export function cleanupChannelSubscriptions(ws: import("ws").WebSocket): void {
  for (const [companyId, subs] of companyChannelSubscriptions) {
    subs.delete(ws);
    if (subs.size === 0) companyChannelSubscriptions.delete(companyId);
  }
  for (const [clinicId, subs] of clinicChannelSubscriptions) {
    subs.delete(ws);
    if (subs.size === 0) clinicChannelSubscriptions.delete(clinicId);
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

export const BUSY_TRIP_STATUSES = ACTIVE_TRIP_STATUSES;
