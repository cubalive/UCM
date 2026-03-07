import { getDb } from "../db/index.js";
import { users, trips, driverLocations, driverStatus as driverStatusTable } from "../db/schema.js";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { recordAudit } from "./auditService.js";
import { broadcastToTenant, broadcastToUser } from "./realtimeService.js";
import logger from "../lib/logger.js";

export type DriverAvailability = "available" | "busy" | "offline" | "break";

export async function getDriversForTenant(tenantId: string) {
  const db = getDb();

  const drivers = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      active: users.active,
    })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "driver")));

  // Enrich with status
  const enriched = await Promise.all(
    drivers.map(async (driver) => {
      const status = await getDriverStatus(driver.id);
      const activeTrips = await db
        .select({ count: sql<number>`count(*)` })
        .from(trips)
        .where(
          and(
            eq(trips.driverId, driver.id),
            inArray(trips.status, ["assigned", "en_route", "arrived", "in_progress"] as any)
          )
        );

      return {
        ...driver,
        availability: status?.availability || "offline",
        lastLocationAt: status?.lastLocationAt,
        latitude: status?.latitude,
        longitude: status?.longitude,
        activeTrips: Number(activeTrips[0]?.count || 0),
      };
    })
  );

  return enriched;
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

  const existing = await getDriverStatus(driverId);

  if (existing) {
    await db
      .update(driverStatusTable)
      .set({
        availability,
        updatedAt: new Date(),
        lastManualOverride: isManualOverride ? new Date() : existing.lastManualOverride,
      })
      .where(eq(driverStatusTable.driverId, driverId));
  } else {
    await db.insert(driverStatusTable).values({
      driverId,
      tenantId,
      availability,
      lastManualOverride: isManualOverride ? new Date() : null,
    });
  }

  if (isManualOverride) {
    await recordAudit({
      tenantId,
      userId: updatedBy,
      action: "driver.status_override",
      resource: "driver",
      resourceId: driverId,
      details: {
        previousStatus: existing?.availability,
        newStatus: availability,
        isManualOverride: true,
      },
    });
    logger.info("Driver status manually overridden", {
      driverId,
      from: existing?.availability,
      to: availability,
      by: updatedBy,
    });
  }

  // Broadcast status change
  broadcastToTenant(tenantId, "driver:status_changed", {
    driverId,
    availability,
    driverName: `${driver.firstName} ${driver.lastName}`,
  });

  broadcastToUser(driverId, "driver:status_changed", { availability });

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

  // Update driver_status location
  const existing = await getDriverStatus(driverId);

  if (existing) {
    await db
      .update(driverStatusTable)
      .set({
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        heading,
        speed,
        lastLocationAt: now,
        updatedAt: now,
      })
      .where(eq(driverStatusTable.driverId, driverId));
  } else {
    await db.insert(driverStatusTable).values({
      driverId,
      tenantId,
      availability: "available",
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      heading,
      speed,
      lastLocationAt: now,
    });
  }

  // Store location history
  await db.insert(driverLocations).values({
    driverId,
    tenantId,
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    heading,
    speed,
    recordedAt: now,
  });

  // Broadcast location to dispatch (throttled by frontend)
  broadcastToTenant(tenantId, "driver:location", {
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
