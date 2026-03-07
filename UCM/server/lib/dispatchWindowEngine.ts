import { db } from "../db";
import { trips, drivers, cities } from "@shared/schema";
import { and, eq, inArray, isNull, gte, lte } from "drizzle-orm";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";
import { transitionTripStatus } from "./tripTransitionHelper";
import { DISPATCH_STAGES } from "@shared/tripStateMachine";
import { computeRouteFromCoords } from "./tripRouteService";
import { broadcastToDriver } from "./realtime";

const INTERVAL_MS = 60_000;
const ENABLED = process.env.DISPATCH_WINDOW_ENABLED !== "false";

const BUFFER_MINUTES: Record<string, number> = {
  WHEELCHAIR: 15,
  wheelchair: 15,
  STRETCHER: 20,
  stretcher: 20,
};
const DEFAULT_BUFFER_MIN = 10;
const NOTIFY_LEAD_MIN = 5;
const DEFAULT_ETA_TO_PICKUP_MIN = 15;

let dispatchTask: HarnessedTask | null = null;

const cityTimezoneCache = new Map<number, string>();

async function getCityTimezone(cityId: number): Promise<string> {
  const cached = cityTimezoneCache.get(cityId);
  if (cached) return cached;
  try {
    const rows = await db.select({ timezone: cities.timezone }).from(cities).where(eq(cities.id, cityId)).limit(1);
    const tz = rows.length > 0 ? rows[0].timezone : "America/New_York";
    cityTimezoneCache.set(cityId, tz);
    return tz;
  } catch {
    return "America/New_York";
  }
}

function getBufferMinutes(mobilityRequirement: string | null): number {
  if (!mobilityRequirement) return DEFAULT_BUFFER_MIN;
  return BUFFER_MINUTES[mobilityRequirement] || DEFAULT_BUFFER_MIN;
}

function localToUtc(scheduledDate: string, timeStr: string, timezone: string): Date | null {
  try {
    const [year, month, day] = scheduledDate.split("-").map(Number);
    const timeParts = timeStr.split(":");
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);
    const second = timeParts.length > 2 ? parseInt(timeParts[2], 10) : 0;

    const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(probe);
    const get = (type: string) => {
      const p = parts.find(p => p.type === type);
      return p ? parseInt(p.value, 10) : 0;
    };
    const probeLocalHour = get("hour") === 24 ? 0 : get("hour");
    const probeLocalMinute = get("minute");
    const probeLocalSecond = get("second");
    const probeLocalMs = (probeLocalHour * 3600 + probeLocalMinute * 60 + probeLocalSecond) * 1000;
    const probeUtcMs = (12 * 3600) * 1000;
    const offsetMs = probeUtcMs - probeLocalMs;

    const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const utcMs = targetLocalMs + offsetMs;
    const result = new Date(utcMs);
    if (isNaN(result.getTime())) return null;

    const verify = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hour: "numeric", minute: "numeric", hour12: false,
    }).formatToParts(result);
    const vHour = parseInt(verify.find(p => p.type === "hour")?.value || "0", 10);
    const vMinute = parseInt(verify.find(p => p.type === "minute")?.value || "0", 10);
    if (vHour !== hour && Math.abs((vHour === 24 ? 0 : vHour) - hour) === 1) {
      return new Date(utcMs + (hour > vHour ? -3600000 : 3600000));
    }

    return result;
  } catch {
    return null;
  }
}

function parseTripDateTime(scheduledDate: string, scheduledTime: string | null, pickupTime: string | null, timezone: string): Date | null {
  const timeStr = pickupTime || scheduledTime;
  if (!timeStr) return null;
  return localToUtc(scheduledDate, timeStr, timezone);
}

async function estimateEtaToPickup(driverRow: any, trip: any): Promise<number> {
  if (!driverRow?.lastLat || !driverRow?.lastLng || !trip.pickupLat || !trip.pickupLng) {
    return DEFAULT_ETA_TO_PICKUP_MIN;
  }

  try {
    const { buildRoute } = await import("./googleMaps");
    const route = await buildRoute(
      { lat: driverRow.lastLat, lng: driverRow.lastLng },
      { lat: Number(trip.pickupLat), lng: Number(trip.pickupLng) }
    );
    return Math.ceil(route.totalMinutes) || DEFAULT_ETA_TO_PICKUP_MIN;
  } catch (err: any) {
    console.warn(`[DISPATCH-WINDOW] ETA calculation failed for trip ${trip.id}:`, err.message);
    return DEFAULT_ETA_TO_PICKUP_MIN;
  }
}

function getLocalDateStr(timezone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

async function runDispatchCycle() {
  const now = new Date();

  const allTimezones = new Set<string>();
  const allCityRows = await db.select({ id: cities.id, timezone: cities.timezone }).from(cities);
  for (const c of allCityRows) {
    cityTimezoneCache.set(c.id, c.timezone);
    allTimezones.add(c.timezone);
  }

  const eligibleDates = new Set<string>();
  for (const tz of allTimezones) {
    const today = getLocalDateStr(tz);
    eligibleDates.add(today);
    const tomorrow = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    tomorrow.setDate(tomorrow.getDate() + 1);
    eligibleDates.add(tomorrow.toLocaleDateString("en-CA"));
  }
  if (eligibleDates.size === 0) {
    const todayStr = now.toISOString().split("T")[0];
    eligibleDates.add(todayStr);
    const tomorrowStr = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    eligibleDates.add(tomorrowStr);
  }

  const dateArr = Array.from(eligibleDates);
  const eligibleTrips = await db
    .select()
    .from(trips)
    .where(
      and(
        inArray(trips.status, ["SCHEDULED", "ASSIGNED"]),
        inArray(trips.scheduledDate, dateArr),
        isNull(trips.deletedAt),
      )
    );

  if (eligibleTrips.length === 0) return;

  let computed = 0;
  let notified = 0;
  let dispatched = 0;

  for (const trip of eligibleTrips) {
    try {
      const timezone = await getCityTimezone(trip.cityId);
      const pickupDt = parseTripDateTime(trip.scheduledDate, trip.scheduledTime, trip.pickupTime, timezone);
      if (!pickupDt) continue;

      const bufferMin = getBufferMinutes(trip.mobilityRequirement);

      let etaToPickupMin = DEFAULT_ETA_TO_PICKUP_MIN;
      if (trip.driverId) {
        const driverRow = await db.select().from(drivers).where(eq(drivers.id, trip.driverId));
        if (driverRow.length > 0) {
          etaToPickupMin = await estimateEtaToPickup(driverRow[0], trip);
        }
      }

      const dispatchAt = new Date(pickupDt.getTime() - (etaToPickupMin + bufferMin) * 60_000);
      const notifyAt = new Date(dispatchAt.getTime() - NOTIFY_LEAD_MIN * 60_000);

      const needsUpdate =
        !trip.dispatchAt ||
        !trip.notifyAt ||
        Math.abs(new Date(trip.dispatchAt).getTime() - dispatchAt.getTime()) > 60_000;

      if (needsUpdate) {
        let etaPickupToDropoffMin: number | null = null;
        let plannedDropoffArrivalAt: Date | null = null;
        if (trip.routeDurationSeconds) {
          etaPickupToDropoffMin = Math.ceil(trip.routeDurationSeconds / 60);
        } else if (trip.durationMinutes) {
          etaPickupToDropoffMin = trip.durationMinutes;
        }
        if (etaPickupToDropoffMin) {
          plannedDropoffArrivalAt = new Date(pickupDt.getTime() + etaPickupToDropoffMin * 60_000);
        }

        await db.update(trips).set({
          dispatchAt,
          notifyAt,
          etaPickupToDropoffMin,
          plannedDropoffArrivalAt,
          updatedAt: new Date(),
        }).where(eq(trips.id, trip.id));
        computed++;
      }

      if (trip.dispatchStage === DISPATCH_STAGES.NONE && now >= notifyAt) {
        const [updateResult] = await db.update(trips).set({
          dispatchStage: DISPATCH_STAGES.NOTIFIED,
          updatedAt: new Date(),
        }).where(
          and(eq(trips.id, trip.id), eq(trips.dispatchStage, DISPATCH_STAGES.NONE))
        ).returning({ id: trips.id });

        if (updateResult && trip.driverId) {
          broadcastToDriver(trip.driverId, {
            type: "dispatch_notify",
            tripId: trip.id,
            pickupAddress: trip.pickupAddress,
            pickupTime: trip.pickupTime,
            patientId: trip.patientId,
            dispatchAt: dispatchAt.toISOString(),
          });

          try {
            const { autoNotifyPatient } = await import("./dispatchAutoSms");
            await autoNotifyPatient(trip.id, "dispatch_notify", {});
          } catch {}
        }
        if (updateResult) notified++;
      }

      const currentStage = trip.dispatchStage === DISPATCH_STAGES.NONE && now >= notifyAt
        ? DISPATCH_STAGES.NOTIFIED
        : trip.dispatchStage;

      if (
        (currentStage === DISPATCH_STAGES.NONE || currentStage === DISPATCH_STAGES.NOTIFIED) &&
        now >= dispatchAt &&
        trip.status === "ASSIGNED" &&
        trip.driverId
      ) {
        if (trip.driverId) {
          await db.update(drivers).set({
            dispatchStatus: "enroute",
            availabilityStatus: "BUSY",
          } as any).where(eq(drivers.id, trip.driverId));
        }

        const result = await transitionTripStatus(trip.id, "EN_ROUTE_TO_PICKUP", {
          userId: 0,
          role: "SYSTEM",
          source: "dispatch_window",
        }, { skipGeofenceCheck: true });

        if (result.success) {
          await db.update(trips).set({
            dispatchStage: DISPATCH_STAGES.DISPATCHED,
            updatedAt: new Date(),
          }).where(eq(trips.id, trip.id));

          if (trip.driverId) {
            broadcastToDriver(trip.driverId, {
              type: "dispatch_now",
              tripId: trip.id,
              pickupAddress: trip.pickupAddress,
              dropoffAddress: trip.dropoffAddress,
              pickupTime: trip.pickupTime,
              patientId: trip.patientId,
              status: "EN_ROUTE_TO_PICKUP",
            });
          }

          if (trip.driverId && trip.pickupLat && trip.pickupLng) {
            const driverRow = await db.select().from(drivers).where(eq(drivers.id, trip.driverId));
            if (driverRow.length > 0 && driverRow[0].lastLat && driverRow[0].lastLng) {
              try {
                await computeRouteFromCoords(
                  trip.id,
                  driverRow[0].lastLat,
                  driverRow[0].lastLng,
                  Number(trip.pickupLat),
                  Number(trip.pickupLng),
                  "dispatch_route"
                );
              } catch (err: any) {
                console.warn(`[DISPATCH-WINDOW] Route compute failed for trip ${trip.id}:`, err.message);
              }
            }
          }

          try {
            const { autoNotifyPatient } = await import("./dispatchAutoSms");
            await autoNotifyPatient(trip.id, "dispatch_go", {});
          } catch {}

          dispatched++;
        } else {
          console.warn(`[DISPATCH-WINDOW] Transition failed for trip ${trip.id}: ${result.error}`);
        }
      }
    } catch (err: any) {
      console.error(`[DISPATCH-WINDOW] Error processing trip ${trip.id}:`, err.message);
    }
  }

  if (computed > 0 || notified > 0 || dispatched > 0) {
    console.log(JSON.stringify({
      event: "dispatch_window_cycle",
      computed,
      notified,
      dispatched,
      tripsProcessed: eligibleTrips.length,
      ts: now.toISOString(),
    }));
  }
}

export async function computeEtaAndDispatchWindow(tripId: number): Promise<void> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip || !trip.driverId) return;

  const timezone = await getCityTimezone(trip.cityId);
  const pickupDt = parseTripDateTime(trip.scheduledDate, trip.scheduledTime, trip.pickupTime, timezone);
  if (!pickupDt) return;

  const bufferMin = getBufferMinutes(trip.mobilityRequirement);

  let etaToPickupMin = DEFAULT_ETA_TO_PICKUP_MIN;
  const driverRow = await db.select().from(drivers).where(eq(drivers.id, trip.driverId));
  if (driverRow.length > 0) {
    etaToPickupMin = await estimateEtaToPickup(driverRow[0], trip);
  }

  const dispatchAt = new Date(pickupDt.getTime() - (etaToPickupMin + bufferMin) * 60_000);
  const notifyAt = new Date(dispatchAt.getTime() - NOTIFY_LEAD_MIN * 60_000);

  let etaPickupToDropoffMin: number | null = null;
  let plannedDropoffArrivalAt: Date | null = null;
  if (trip.routeDurationSeconds) {
    etaPickupToDropoffMin = Math.ceil(trip.routeDurationSeconds / 60);
  } else if (trip.durationMinutes) {
    etaPickupToDropoffMin = trip.durationMinutes;
  }
  if (etaPickupToDropoffMin) {
    plannedDropoffArrivalAt = new Date(pickupDt.getTime() + etaPickupToDropoffMin * 60_000);
  }

  await db.update(trips).set({
    dispatchAt,
    notifyAt,
    etaDriverToPickupMin: etaToPickupMin,
    serviceBufferMin: bufferMin,
    etaPickupToDropoffMin,
    plannedDropoffArrivalAt,
    updatedAt: new Date(),
  } as any).where(eq(trips.id, tripId));

  console.log(JSON.stringify({
    event: "dispatch_window_computed",
    tripId,
    etaToPickupMin,
    bufferMin,
    dispatchAt: dispatchAt.toISOString(),
    notifyAt: notifyAt.toISOString(),
  }));
}

export async function simulateDispatchFlow(tripId: number): Promise<any> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) return { error: "Trip not found" };

  const driverRow = trip.driverId ? await db.select().from(drivers).where(eq(drivers.id, trip.driverId)) : [];
  const driver = driverRow.length > 0 ? driverRow[0] : null;

  const now = new Date();
  const log: string[] = [];

  log.push(`Trip ${trip.publicId} (ID: ${trip.id})`);
  log.push(`Status: ${trip.status}`);
  log.push(`Dispatch stage: ${trip.dispatchStage}`);
  log.push(`Scheduled: ${trip.scheduledDate} ${trip.pickupTime}`);

  if (driver) {
    log.push(`Driver: ${driver.firstName} ${driver.lastName} (ID: ${driver.id})`);
    log.push(`Driver dispatch status: ${driver.dispatchStatus}`);
    log.push(`Driver availability: ${(driver as any).availabilityStatus ?? "N/A"}`);
    log.push(`Driver remains Available until dispatch_at — confirmed: ${driver.dispatchStatus !== "enroute" && driver.dispatchStatus !== "busy"}`);
  } else {
    log.push("No driver assigned");
  }

  if (trip.dispatchAt) {
    const dispatchAt = new Date(trip.dispatchAt);
    const notifyAt = trip.notifyAt ? new Date(trip.notifyAt) : null;
    log.push(`dispatch_at: ${dispatchAt.toISOString()}`);
    log.push(`notify_at: ${notifyAt?.toISOString() ?? "N/A"}`);
    log.push(`eta_driver_to_pickup_min: ${(trip as any).etaDriverToPickupMin ?? "N/A"}`);
    log.push(`service_buffer_min: ${(trip as any).serviceBufferMin ?? "N/A"}`);

    if (notifyAt && now >= notifyAt && trip.dispatchStage === "NONE") {
      log.push(`⏰ notify_at has passed — will transition to NOTIFIED on next scheduler cycle`);
    }
    if (now >= dispatchAt && trip.status === "ASSIGNED") {
      log.push(`🚀 dispatch_at has passed — will transition ASSIGNED → EN_ROUTE_TO_PICKUP on next scheduler cycle`);
      log.push(`Driver will be set to Busy / On Trip at dispatch time`);
    }
    if (now < dispatchAt) {
      const minutesUntilDispatch = Math.round((dispatchAt.getTime() - now.getTime()) / 60_000);
      log.push(`⏳ ${minutesUntilDispatch} min until dispatch`);
    }
  } else {
    log.push("No dispatch_at computed yet");
  }

  return {
    tripId: trip.id,
    publicId: trip.publicId,
    status: trip.status,
    dispatchStage: trip.dispatchStage,
    driverId: trip.driverId,
    driverStatus: driver?.dispatchStatus ?? null,
    driverAvailability: (driver as any)?.availabilityStatus ?? null,
    dispatchAt: trip.dispatchAt?.toISOString() ?? null,
    notifyAt: trip.notifyAt?.toISOString() ?? null,
    etaDriverToPickupMin: (trip as any).etaDriverToPickupMin ?? null,
    serviceBufferMin: (trip as any).serviceBufferMin ?? null,
    log,
  };
}

export function startDispatchWindowScheduler() {
  if (!ENABLED) {
    console.log("[DISPATCH-WINDOW] Disabled via DISPATCH_WINDOW_ENABLED=false");
    return;
  }

  if (dispatchTask) return;

  dispatchTask = createHarnessedTask({
    name: "dispatch_window",
    lockKey: "scheduler:lock:dispatch_window",
    lockTtlSeconds: 30,
    timeoutMs: 120_000,
    fn: runDispatchCycle,
  });

  registerInterval("dispatch_window", INTERVAL_MS, dispatchTask);
  console.log("[DISPATCH-WINDOW] Scheduler started (interval: 60s)");
}
