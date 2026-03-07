import { getDb, getPool } from "../db/index.js";
import { trips, users, patients, tenants } from "../db/schema.js";
import { eq, and, sql, between, desc, inArray } from "drizzle-orm";
import { recordAudit } from "./auditService.js";
import logger from "../lib/logger.js";
import { broadcastToTenant, broadcastToUser, broadcastToRole, WS_EVENTS } from "./realtimeService.js";
import { autoSetBusy, autoSetAvailable } from "./driverService.js";
import { DEFAULT_TIMEZONE } from "../lib/timezone.js";

// Valid state transitions for trip lifecycle
const VALID_TRANSITIONS: Record<string, string[]> = {
  requested: ["assigned", "cancelled"],
  assigned: ["en_route", "cancelled", "requested"], // back to requested if driver declines
  en_route: ["arrived", "cancelled", "assigned"],
  arrived: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface CreateTripInput {
  tenantId: string;
  patientId: string;
  pickupAddress: string;
  dropoffAddress: string;
  scheduledAt: Date;
  timezone?: string;
  notes?: string;
  isImmediate?: boolean;
  requestedBy?: string;
}

export async function createTrip(input: CreateTripInput) {
  const db = getDb();

  // Resolve timezone: use provided timezone, or fall back to tenant timezone
  let tripTimezone = input.timezone || DEFAULT_TIMEZONE;
  if (!input.timezone) {
    const [tenant] = await db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, input.tenantId));
    if (tenant?.timezone) tripTimezone = tenant.timezone;
  }

  const [trip] = await db
    .insert(trips)
    .values({
      tenantId: input.tenantId,
      patientId: input.patientId,
      pickupAddress: input.pickupAddress,
      dropoffAddress: input.dropoffAddress,
      scheduledAt: input.scheduledAt,
      timezone: tripTimezone,
      status: "requested",
      notes: input.notes,
      metadata: {
        isImmediate: input.isImmediate || false,
        requestedBy: input.requestedBy,
        requestedAt: new Date().toISOString(),
      },
    })
    .returning();

  await recordAudit({
    tenantId: input.tenantId,
    userId: input.requestedBy,
    action: "trip.created",
    resource: "trip",
    resourceId: trip.id,
    details: { isImmediate: input.isImmediate, pickupAddress: input.pickupAddress },
  });

  // Notify dispatch in realtime
  broadcastToTenant(input.tenantId, WS_EVENTS.TRIP_CREATED, {
    trip,
    isImmediate: input.isImmediate || false,
  });

  // Fire urgent event for immediate trips so dispatchers get alerted
  if (input.isImmediate) {
    broadcastToRole(input.tenantId, "dispatcher", WS_EVENTS.URGENT_TRIP_REQUEST, {
      trip,
      message: `Urgent trip request from ${input.pickupAddress}`,
    });
  }

  logger.info("Trip created", { tripId: trip.id, tenantId: input.tenantId, isImmediate: input.isImmediate });
  return trip;
}

export async function assignTrip(tripId: string, driverId: string, tenantId: string, assignedBy?: string) {
  const db = getDb();

  // Verify driver exists and belongs to tenant (outside transaction — read-only)
  const [driver] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, driverId), eq(users.tenantId, tenantId), eq(users.role, "driver")));

  if (!driver) throw new Error("Driver not found");

  // Use atomic update with WHERE clause to prevent race conditions
  const [updated] = await db
    .update(trips)
    .set({
      driverId,
      status: "assigned",
      updatedAt: new Date(),
      metadata: sql`jsonb_set(
        COALESCE(${trips.metadata}, '{}'::jsonb),
        '{assignedAt}',
        to_jsonb(${new Date().toISOString()}::text)
      ) || jsonb_build_object('assignedBy', ${assignedBy || null}::text)`,
    })
    .where(
      and(
        eq(trips.id, tripId),
        eq(trips.tenantId, tenantId),
        inArray(trips.status, ["requested", "assigned"] as any)
      )
    )
    .returning();

  if (!updated) {
    throw new Error("Trip not found or cannot be assigned in its current status");
  }

  await recordAudit({
    tenantId,
    userId: assignedBy,
    action: "trip.assigned",
    resource: "trip",
    resourceId: tripId,
    details: { driverId, driverName: `${driver.firstName} ${driver.lastName}` },
  });

  // Auto-set driver to busy
  try {
    await autoSetBusy(driverId, tenantId);
  } catch (err) {
    logger.warn("Failed to auto-set driver busy", { driverId, error: (err as Error).message });
  }

  // Notify driver immediately
  broadcastToUser(driverId, WS_EVENTS.TRIP_ASSIGNED, { trip: updated });

  // Notify dispatch
  broadcastToTenant(tenantId, WS_EVENTS.TRIP_UPDATED, { trip: updated });

  logger.info("Trip assigned", { tripId, driverId });
  return updated;
}

export async function updateTripStatus(
  tripId: string,
  newStatus: string,
  tenantId: string,
  userId?: string,
  extra?: { mileage?: number; userRole?: string }
) {
  const db = getDb();

  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)));

  if (!trip) throw new Error("Trip not found");

  // Drivers can only update trips assigned to them
  if (extra?.userRole === "driver" && trip.driverId !== userId) {
    throw new Error("You can only update trips assigned to you");
  }

  if (!canTransition(trip.status, newStatus)) {
    throw new Error(`Invalid transition: ${trip.status} → ${newStatus}`);
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  if (newStatus === "en_route" || newStatus === "in_progress") {
    if (!trip.startedAt) {
      updateData.startedAt = new Date();
    }
  }

  if (newStatus === "completed") {
    updateData.completedAt = new Date();
    if (extra?.mileage) {
      updateData.mileage = extra.mileage.toFixed(2);
    }
  }

  const [updated] = await db
    .update(trips)
    .set(updateData)
    .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)))
    .returning();

  if (!updated) throw new Error("Trip not found or update failed");

  await recordAudit({
    tenantId,
    userId,
    action: `trip.${newStatus}`,
    resource: "trip",
    resourceId: tripId,
    details: { previousStatus: trip.status, newStatus },
  });

  // Record driver earnings when trip completes
  if (newStatus === "completed" && trip.driverId) {
    try {
      const { recordTripEarning } = await import("./driverEarningsService.js");
      const mileage = Number(extra?.mileage || trip.mileage || 0);
      const earning = Math.max(5, 5 + mileage * 1.5);
      await recordTripEarning(trip.driverId, tenantId, tripId, Math.round(earning * 100) / 100);
    } catch (err) {
      logger.warn("Failed to record trip earning", { tripId, driverId: trip.driverId, error: (err as Error).message });
    }
  }

  // Auto-release driver when trip ends
  if ((newStatus === "completed" || newStatus === "cancelled") && trip.driverId) {
    try {
      await autoSetAvailable(trip.driverId, tenantId);
    } catch (err) {
      logger.warn("Failed to auto-set driver available", { driverId: trip.driverId, error: (err as Error).message });
    }
  }

  // Broadcast to dispatch and driver
  broadcastToTenant(tenantId, WS_EVENTS.TRIP_UPDATED, { trip: updated });
  if (trip.driverId) {
    broadcastToUser(trip.driverId, WS_EVENTS.TRIP_UPDATED, { trip: updated });
  }

  logger.info("Trip status updated", { tripId, from: trip.status, to: newStatus });
  return updated;
}

export async function getTripsForDispatch(tenantId: string, filters?: {
  status?: string[];
  driverId?: string;
  date?: string;
}) {
  const db = getDb();

  let query = db.select().from(trips).where(eq(trips.tenantId, tenantId));

  // We'll apply filters at the SQL level
  const conditions = [eq(trips.tenantId, tenantId)];

  if (filters?.status && filters.status.length > 0) {
    conditions.push(inArray(trips.status, filters.status as any));
  }
  if (filters?.driverId) {
    conditions.push(eq(trips.driverId, filters.driverId));
  }

  const results = await db
    .select()
    .from(trips)
    .where(and(...conditions))
    .orderBy(desc(trips.scheduledAt))
    .limit(200);

  return results;
}

export async function getTripById(tripId: string, tenantId: string) {
  const db = getDb();

  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)));

  if (!trip) return null;

  // Enrich with patient and driver info (tenant-scoped)
  let patient = null;
  let driver = null;

  if (trip.patientId) {
    const [p] = await db.select().from(patients).where(
      and(eq(patients.id, trip.patientId), eq(patients.tenantId, tenantId))
    );
    patient = p || null;
  }

  if (trip.driverId) {
    const [d] = await db.select().from(users).where(
      and(eq(users.id, trip.driverId), eq(users.tenantId, tenantId))
    );
    driver = d ? { id: d.id, firstName: d.firstName, lastName: d.lastName, email: d.email } : null;
  }

  return { ...trip, patient, driver };
}

export async function getDriverTrips(driverId: string, tenantId: string, activeOnly: boolean = false) {
  const db = getDb();

  const conditions = [eq(trips.tenantId, tenantId), eq(trips.driverId, driverId)];

  if (activeOnly) {
    conditions.push(inArray(trips.status, ["assigned", "en_route", "arrived", "in_progress"] as any));
  }

  const results = await db
    .select()
    .from(trips)
    .where(and(...conditions))
    .orderBy(desc(trips.scheduledAt))
    .limit(100);

  // Enrich with patient names
  const patientIds = [...new Set(results.map(t => t.patientId).filter(Boolean))] as string[];
  let patientMap = new Map<string, string>();

  if (patientIds.length > 0) {
    const patientRows = await db
      .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName })
      .from(patients)
      .where(inArray(patients.id, patientIds));
    patientMap = new Map(patientRows.map(p => [p.id, `${p.firstName} ${p.lastName}`]));
  }

  return results.map(t => ({
    ...t,
    patientName: t.patientId ? patientMap.get(t.patientId) || null : null,
    priority: (t.metadata as any)?.isImmediate ? "immediate" : "scheduled",
  }));
}

export async function acceptTrip(tripId: string, driverId: string, tenantId: string) {
  const db = getDb();
  const [trip] = await db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)));
  if (!trip) throw new Error("Trip not found");
  if (trip.status !== "assigned" || trip.driverId !== driverId) {
    throw new Error("Trip is not assigned to this driver");
  }

  const [updated] = await db
    .update(trips)
    .set({
      updatedAt: new Date(),
      metadata: {
        ...(trip.metadata as Record<string, unknown>),
        acceptedAt: new Date().toISOString(),
        acceptedByDriver: true,
      },
    })
    .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)))
    .returning();

  await recordAudit({ tenantId, userId: driverId, action: "trip.accepted", resource: "trip", resourceId: tripId, details: { driverId } });
  broadcastToTenant(tenantId, WS_EVENTS.TRIP_ACCEPTED, { trip: updated });
  broadcastToUser(driverId, WS_EVENTS.TRIP_ACCEPTED, { trip: updated });
  logger.info("Trip accepted by driver", { tripId, driverId });
  return updated;
}

export async function declineTrip(tripId: string, driverId: string, tenantId: string, reason?: string) {
  const db = getDb();
  const [trip] = await db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)));
  if (!trip) throw new Error("Trip not found");
  if (trip.status !== "assigned" || trip.driverId !== driverId) {
    throw new Error("Trip is not assigned to this driver");
  }

  const [updated] = await db
    .update(trips)
    .set({
      status: "requested",
      driverId: null,
      updatedAt: new Date(),
      metadata: {
        ...(trip.metadata as Record<string, unknown>),
        declinedAt: new Date().toISOString(),
        declinedBy: driverId,
        declineReason: reason,
        previousDriverId: driverId,
      },
    })
    .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)))
    .returning();

  await recordAudit({ tenantId, userId: driverId, action: "trip.declined", resource: "trip", resourceId: tripId, details: { driverId, reason } });
  try { await autoSetAvailable(driverId, tenantId); } catch { /* non-fatal */ }
  broadcastToTenant(tenantId, WS_EVENTS.TRIP_UPDATED, { trip: updated });
  logger.info("Trip declined by driver", { tripId, driverId });
  return updated;
}

export async function cancelTrip(tripId: string, tenantId: string, userId?: string, reason?: string) {
  const db = getDb();

  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)));

  if (!trip) throw new Error("Trip not found");
  if (trip.status === "completed") throw new Error("Cannot cancel a completed trip");
  if (trip.status === "cancelled") throw new Error("Trip is already cancelled");

  const [updated] = await db
    .update(trips)
    .set({
      status: "cancelled",
      updatedAt: new Date(),
      metadata: {
        ...(trip.metadata as Record<string, unknown>),
        cancelledAt: new Date().toISOString(),
        cancelledBy: userId,
        cancellationReason: reason,
      },
    })
    .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)))
    .returning();

  await recordAudit({
    tenantId,
    userId,
    action: "trip.cancelled",
    resource: "trip",
    resourceId: tripId,
    details: { reason, previousStatus: trip.status },
  });

  // Auto-release driver if no other active trips
  if (trip.driverId) {
    try {
      await autoSetAvailable(trip.driverId, tenantId);
    } catch (err) {
      logger.warn("Failed to auto-set driver available after cancel", { driverId: trip.driverId, error: (err as Error).message });
    }
  }

  broadcastToTenant(tenantId, WS_EVENTS.TRIP_CANCELLED, { trip: updated });
  if (trip.driverId) {
    broadcastToUser(trip.driverId, WS_EVENTS.TRIP_CANCELLED, { trip: updated });
  }

  return updated;
}
