import { getDb } from "../db/index.js";
import { users, trips, driverLocations, driverStatus as driverStatusTable } from "../db/schema.js";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { recordAudit } from "./auditService.js";
import { broadcastToTenant, broadcastToUser, WS_EVENTS } from "./realtimeService.js";
import logger from "../lib/logger.js";

export type DriverAvailability = "available" | "busy" | "offline" | "break";

// --- Location History Batching ---
// Buffer location history records in memory and flush every 10 seconds
// to reduce DB write pressure from high-frequency driver location updates
interface LocationRecord {
  driverId: string;
  tenantId: string;
  latitude: string;
  longitude: string;
  heading?: number;
  speed?: number;
  recordedAt: Date;
}

const locationBuffer: LocationRecord[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

async function flushLocationBuffer() {
  if (locationBuffer.length === 0) return;

  const batch = locationBuffer.splice(0, locationBuffer.length);
  try {
    const db = getDb();
    await db.insert(driverLocations).values(batch);
  } catch (err) {
    logger.error("Failed to flush location buffer", {
      count: batch.length,
      error: (err as Error).message,
    });
    // Re-add failed records back to buffer for next flush (limit to prevent OOM)
    if (locationBuffer.length < 5000) {
      locationBuffer.push(...batch);
    }
  }
}

// Start the flush timer
if (!flushTimer) {
  flushTimer = setInterval(flushLocationBuffer, 10000);
  // Ensure buffer is flushed on process exit
  process.on("beforeExit", () => { flushLocationBuffer(); });
}

export async function getDriversForTenant(tenantId: string) {
  const db = getDb();

  // Single query with LEFT JOIN — eliminates N+1
  const driversWithStatus = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      active: users.active,
      availability: driverStatusTable.availability,
      lastLocationAt: driverStatusTable.lastLocationAt,
      latitude: driverStatusTable.latitude,
      longitude: driverStatusTable.longitude,
    })
    .from(users)
    .leftJoin(driverStatusTable, eq(users.id, driverStatusTable.driverId))
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "driver")));

  // Batch active trip counts in one query
  const driverIds = driversWithStatus.map(d => d.id);
  let tripCountMap = new Map<string, number>();

  if (driverIds.length > 0) {
    const tripCounts = await db
      .select({
        driverId: trips.driverId,
        count: sql<number>`count(*)`,
      })
      .from(trips)
      .where(
        and(
          inArray(trips.driverId, driverIds),
          inArray(trips.status, ["assigned", "en_route", "arrived", "in_progress"] as any)
        )
      )
      .groupBy(trips.driverId);

    tripCountMap = new Map(tripCounts.map(tc => [tc.driverId!, Number(tc.count)]));
  }

  return driversWithStatus.map(d => ({
    id: d.id,
    firstName: d.firstName,
    lastName: d.lastName,
    email: d.email,
    active: d.active,
    availability: d.availability || "offline",
    lastLocationAt: d.lastLocationAt,
    latitude: d.latitude,
    longitude: d.longitude,
    activeTrips: tripCountMap.get(d.id) || 0,
  }));
}

export async function getDriverStatus(driverId: string) {
  const db = getDb();

  const [status] = await db
    .select()
    .from(driverStatusTable)
    .where(eq(driverStatusTable.driverId, driverId));

  return status || null;
}

export async function updateDriverAvailability(
  driverId: string,
  tenantId: string,
  availability: DriverAvailability,
  updatedBy?: string,
  isManualOverride: boolean = false
) {
  const db = getDb();

  // Verify driver belongs to tenant
  const [driver] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, driverId), eq(users.tenantId, tenantId), eq(users.role, "driver")));

  if (!driver) throw new Error("Driver not found");

  const existingBefore = await getDriverStatus(driverId);

  // Atomic upsert using ON CONFLICT — prevents race condition
  await db
    .insert(driverStatusTable)
    .values({
      driverId,
      tenantId,
      availability,
      lastManualOverride: isManualOverride ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: driverStatusTable.driverId,
      set: {
        availability,
        updatedAt: new Date(),
        ...(isManualOverride ? { lastManualOverride: new Date() } : {}),
      },
    });

  if (isManualOverride) {
    await recordAudit({
      tenantId,
      userId: updatedBy,
      action: "driver.status_override",
      resource: "driver",
      resourceId: driverId,
      details: {
        previousStatus: existingBefore?.availability,
        newStatus: availability,
        isManualOverride: true,
      },
    });
    logger.info("Driver status manually overridden", {
      driverId,
      from: existingBefore?.availability,
      to: availability,
      by: updatedBy,
    });
  }

  // Broadcast status change
  broadcastToTenant(tenantId, WS_EVENTS.DRIVER_STATUS_UPDATE, {
    driverId,
    availability,
    driverName: `${driver.firstName} ${driver.lastName}`,
  });

  broadcastToUser(driverId, WS_EVENTS.DRIVER_STATUS_UPDATE, { availability });

  return { driverId, availability };
}

export async function updateDriverLocation(
  driverId: string,
  tenantId: string,
  latitude: number,
  longitude: number,
  heading?: number,
  speed?: number
) {
  const db = getDb();
  const now = new Date();

  // Atomic upsert for driver location — preserves current availability on conflict
  await db
    .insert(driverStatusTable)
    .values({
      driverId,
      tenantId,
      availability: "available", // default for new record: driver sending location is active
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      heading,
      speed,
      lastLocationAt: now,
    })
    .onConflictDoUpdate({
      target: driverStatusTable.driverId,
      set: {
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        heading,
        speed,
        lastLocationAt: now,
        updatedAt: now,
        // Note: availability is NOT updated here — preserves current state
      },
    });

  // Buffer location history for batched writes (flushed every 10s)
  locationBuffer.push({
    driverId,
    tenantId,
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    heading,
    speed,
    recordedAt: now,
  });

  // Broadcast location to dispatch (throttled by frontend)
  broadcastToTenant(tenantId, WS_EVENTS.DRIVER_LOCATION_UPDATE, {
    driverId,
    latitude,
    longitude,
    heading,
    speed,
    timestamp: now.toISOString(),
  });

  return { driverId, latitude, longitude };
}

export async function autoSetBusy(driverId: string, tenantId: string) {
  return updateDriverAvailability(driverId, tenantId, "busy", undefined, false);
}

export async function autoSetAvailable(driverId: string, tenantId: string) {
  // Only auto-set if no other active trips
  const db = getDb();
  const [activeCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        inArray(trips.status, ["assigned", "en_route", "arrived", "in_progress"] as any)
      )
    );

  if (Number(activeCount.count) === 0) {
    return updateDriverAvailability(driverId, tenantId, "available", undefined, false);
  }
  return null;
}

export async function detectStaleDrivers(tenantId: string, staleMinutes: number = 15) {
  const db = getDb();
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  const staleDrivers = await db
    .select()
    .from(driverStatusTable)
    .where(
      and(
        eq(driverStatusTable.tenantId, tenantId),
        eq(driverStatusTable.availability, "available"),
        sql`${driverStatusTable.lastLocationAt} < ${cutoff}`
      )
    );

  return staleDrivers;
}
