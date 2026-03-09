import { db } from "../db";
import { drivers, trips } from "@shared/schema";
import { and, eq, inArray, isNull, lte, ne, isNotNull, gt, sql } from "drizzle-orm";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";
import { broadcastToDriver, broadcastToTrip } from "./realtime";

const INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 60_000;
const ACTIVE_TRIP_STATUSES = ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"] as const;

let healthTask: HarnessedTask | null = null;

async function runTrackingHealthCheck() {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_MS);

  const staleDrivers = await db
    .select({ id: drivers.id, lastSeenAt: drivers.lastSeenAt, trackingStatus: drivers.trackingStatus })
    .from(drivers)
    .where(
      and(
        eq(drivers.connected, true),
        ne(drivers.trackingStatus, "STALE"),
        isNotNull(drivers.lastSeenAt),
        lte(drivers.lastSeenAt, staleThreshold),
      )
    )
    .limit(50);

  let staleCount = 0;
  let recoveredCount = 0;

  for (const driver of staleDrivers) {
    await db.update(drivers).set({
      trackingStatus: "STALE",
    } as any).where(
      and(eq(drivers.id, driver.id), ne(drivers.trackingStatus, "STALE"))
    );

    broadcastToDriver(driver.id, {
      type: "tracking_stale",
      message: "Location signal lost. Please open the app to resume tracking.",
    });

    const activeTrips = await db
      .select({ id: trips.id, clinicId: trips.clinicId, companyId: trips.companyId })
      .from(trips)
      .where(
        and(
          eq(trips.driverId, driver.id),
          inArray(trips.status, [...ACTIVE_TRIP_STATUSES]),
          isNull(trips.deletedAt),
        )
      );

    for (const trip of activeTrips) {
      broadcastToTrip(trip.id, {
        type: "status_change",
        data: {
          event: "tracking_paused",
          driverId: driver.id,
          message: "Driver tracking signal paused",
        },
      });

      if (trip.clinicId) {
        try {
          const { broadcastToClinicChannel } = require("./tripTransitionHelper");
          broadcastToClinicChannel(trip.clinicId, {
            type: "tracking_paused",
            tripId: trip.id,
            driverId: driver.id,
          });
        } catch {}
      }

      if (trip.companyId) {
        try {
          const { broadcastToCompanyChannel } = require("./tripTransitionHelper");
          broadcastToCompanyChannel(trip.companyId, {
            type: "tracking_paused",
            tripId: trip.id,
            driverId: driver.id,
          });
        } catch {}
      }
    }

    staleCount++;
  }

  const recoveredDrivers = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(
      and(
        eq(drivers.trackingStatus, "STALE"),
        isNotNull(drivers.lastSeenAt),
        gt(drivers.lastSeenAt, staleThreshold),
      )
    )
    .limit(50);

  for (const driver of recoveredDrivers) {
    await db.update(drivers).set({
      trackingStatus: "OK",
    } as any).where(
      and(eq(drivers.id, driver.id), eq(drivers.trackingStatus, "STALE"))
    );

    broadcastToDriver(driver.id, {
      type: "tracking_restored",
      message: "Location tracking restored",
    });

    const activeTrips = await db
      .select({ id: trips.id, clinicId: trips.clinicId, companyId: trips.companyId })
      .from(trips)
      .where(
        and(
          eq(trips.driverId, driver.id),
          inArray(trips.status, [...ACTIVE_TRIP_STATUSES]),
          isNull(trips.deletedAt),
        )
      );

    for (const trip of activeTrips) {
      broadcastToTrip(trip.id, {
        type: "status_change",
        data: {
          event: "tracking_restored",
          driverId: driver.id,
          message: "Driver tracking restored",
        },
      });
    }

    recoveredCount++;
  }

  if (staleCount > 0 || recoveredCount > 0) {
    console.log(JSON.stringify({
      event: "tracking_health_cycle",
      staleCount,
      recoveredCount,
      ts: now.toISOString(),
    }));
  }
}

export function startTrackingHealthScheduler() {
  if (healthTask) return;

  healthTask = createHarnessedTask({
    name: "tracking_health",
    lockKey: "scheduler:lock:tracking_health",
    lockTtlSeconds: 15,
    timeoutMs: 30_000,
    fn: runTrackingHealthCheck,
  });

  registerInterval("tracking_health", INTERVAL_MS, healthTask);
  console.log("[TRACKING-HEALTH] Scheduler started (interval: 30s)");
}
