import { db } from "../db";
import { trips, companies, drivers, automationEvents } from "@shared/schema";
import { eq, and, sql, isNull, ne } from "drizzle-orm";
import { runAutoAssignForTrip } from "./autoAssignV2Engine";

const PREASSIGN_MINUTES = 60;
const RECHECK_MINUTES = 15;
const GEOFENCE_RADIUS_M = 150;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function minutesUntilPickup(pickupTime: string, scheduledDate: string): number {
  const now = new Date();
  const [h, m] = pickupTime.split(":").map(Number);
  const pickup = new Date(scheduledDate + "T00:00:00");
  pickup.setHours(h, m, 0, 0);
  return (pickup.getTime() - now.getTime()) / 60000;
}

export async function runDialysisPreAssign(): Promise<{ processed: number; assigned: number; failed: number }> {
  let processed = 0, assigned = 0, failed = 0;

  const today = new Date().toISOString().split("T")[0];

  const enabledCompanies = await db.select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.zeroTouchDialysisEnabled, true), isNull(companies.deletedAt)));

  if (enabledCompanies.length === 0) return { processed: 0, assigned: 0, failed: 0 };

  const companyIds = enabledCompanies.map(c => c.id);

  const result = await db.execute(sql`
    SELECT id, pickup_time, scheduled_date, company_id, driver_id, status
    FROM trips
    WHERE trip_type = 'dialysis'
    AND scheduled_date = ${today}
    AND status = 'SCHEDULED'
    AND driver_id IS NULL
    AND deleted_at IS NULL
    AND company_id = ANY(${sql.raw(`ARRAY[${companyIds.join(",")}]`)})
  `);

  const dialysisTrips = (result as any).rows || result;
  if (!Array.isArray(dialysisTrips)) return { processed: 0, assigned: 0, failed: 0 };

  for (const trip of dialysisTrips) {
    const minsUntil = minutesUntilPickup(trip.pickup_time, trip.scheduled_date);

    if (minsUntil <= PREASSIGN_MINUTES && minsUntil > 0) {
      processed++;

      try {
        const assignResult = await runAutoAssignForTrip(trip.id);
        if (assignResult.success) {
          assigned++;
          await db.insert(automationEvents).values({
            eventType: "DIALYSIS_AUTO_ASSIGN",
            tripId: trip.id,
            driverId: assignResult.selectedDriverId || null,
            companyId: trip.company_id,
            runId: assignResult.runId || null,
            payload: {
              minutesBeforePickup: Math.round(minsUntil),
              phase: "pre_assign",
            },
          });
        } else {
          failed++;
        }
      } catch (err: any) {
        failed++;
        console.warn(`[DIALYSIS] Pre-assign failed for trip ${trip.id}: ${err.message}`);
      }
    }
  }

  return { processed, assigned, failed };
}

export async function runDialysisRecheck(): Promise<{ checked: number; reassigned: number }> {
  let checked = 0, reassigned = 0;
  const today = new Date().toISOString().split("T")[0];

  const enabledCompanies = await db.select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.zeroTouchDialysisEnabled, true), isNull(companies.deletedAt)));

  if (enabledCompanies.length === 0) return { checked: 0, reassigned: 0 };
  const companyIds = enabledCompanies.map(c => c.id);

  const result = await db.execute(sql`
    SELECT t.id, t.pickup_time, t.scheduled_date, t.company_id, t.driver_id, t.pickup_lat, t.pickup_lng
    FROM trips t
    WHERE t.trip_type = 'dialysis'
    AND t.scheduled_date = ${today}
    AND t.status = 'ASSIGNED'
    AND t.driver_id IS NOT NULL
    AND t.deleted_at IS NULL
    AND t.company_id = ANY(${sql.raw(`ARRAY[${companyIds.join(",")}]`)})
  `);

  const assignedTrips = (result as any).rows || result;
  if (!Array.isArray(assignedTrips)) return { checked: 0, reassigned: 0 };

  for (const trip of assignedTrips) {
    const minsUntil = minutesUntilPickup(trip.pickup_time, trip.scheduled_date);

    if (minsUntil <= RECHECK_MINUTES && minsUntil > 0) {
      checked++;

      if (!trip.driver_id) continue;

      const [driver] = await db.select({
        lastLat: drivers.lastLat,
        lastLng: drivers.lastLng,
        lastSeenAt: drivers.lastSeenAt,
        dispatchStatus: drivers.dispatchStatus,
      }).from(drivers).where(eq(drivers.id, trip.driver_id));

      if (!driver) continue;

      let needsReassign = false;
      let reason = "";

      if (driver.dispatchStatus === "off") {
        needsReassign = true;
        reason = "Driver went offline";
      } else if (!driver.lastLat || !driver.lastLng) {
        needsReassign = true;
        reason = "Driver GPS unavailable";
      } else if (driver.lastSeenAt && (Date.now() - driver.lastSeenAt.getTime()) > 180000) {
        needsReassign = true;
        reason = "Driver GPS stale (>3 min)";
      } else if (trip.pickup_lat && trip.pickup_lng && driver.lastLat && driver.lastLng) {
        const dist = haversineMeters(
          Number(trip.pickup_lat), Number(trip.pickup_lng),
          driver.lastLat, driver.lastLng
        );
        if (dist > 30000) {
          needsReassign = true;
          reason = `Driver too far (${Math.round(dist / 1000)}km away)`;
        }
      }

      if (needsReassign) {
        await db.update(trips).set({
          driverId: null,
          status: "SCHEDULED",
          assignedAt: null,
          assignmentSource: null,
          assignmentReason: null,
        } as any).where(eq(trips.id, trip.id));

        await db.insert(automationEvents).values({
          eventType: "DIALYSIS_AUTO_REASSIGN",
          tripId: trip.id,
          driverId: trip.driver_id,
          companyId: trip.company_id,
          payload: { reason, minutesBeforePickup: Math.round(minsUntil) },
        });

        try {
          const assignResult = await runAutoAssignForTrip(trip.id);
          if (assignResult.success) reassigned++;
        } catch {}
      }
    }
  }

  return { checked, reassigned };
}

export async function checkDialysisGeofence(
  driverId: number,
  lat: number,
  lng: number
): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  const result = await db.execute(sql`
    SELECT t.id, t.pickup_lat, t.pickup_lng, t.company_id
    FROM trips t
    JOIN companies c ON c.id = t.company_id
    WHERE t.trip_type = 'dialysis'
    AND t.scheduled_date = ${today}
    AND t.driver_id = ${driverId}
    AND t.status IN ('ASSIGNED', 'EN_ROUTE_TO_PICKUP')
    AND t.deleted_at IS NULL
    AND c.zero_touch_dialysis_enabled = true
  `);

  const tripRows = (result as any).rows || result;
  if (!Array.isArray(tripRows)) return;

  for (const trip of tripRows) {
    if (!trip.pickup_lat || !trip.pickup_lng) continue;

    const dist = haversineMeters(lat, lng, Number(trip.pickup_lat), Number(trip.pickup_lng));
    if (dist <= GEOFENCE_RADIUS_M) {
      await db.update(trips).set({
        status: "ARRIVED_PICKUP",
        arrivedPickupAt: new Date(),
      } as any).where(eq(trips.id, trip.id));

      await db.insert(automationEvents).values({
        eventType: "DIALYSIS_AUTO_ARRIVE",
        tripId: trip.id,
        driverId,
        companyId: trip.company_id,
        payload: {
          distanceMeters: Math.round(dist),
          geofenceRadiusMeters: GEOFENCE_RADIUS_M,
          driverLat: lat,
          driverLng: lng,
        },
      });
    }
  }
}

export async function getDialysisTripsSummary(filters: {
  companyId?: number;
  date?: string;
}) {
  const date = filters.date || new Date().toISOString().split("T")[0];

  const conditions = [
    sql`t.trip_type = 'dialysis'`,
    sql`t.scheduled_date = ${date}`,
    sql`t.deleted_at IS NULL`,
  ];
  if (filters.companyId) conditions.push(sql`t.company_id = ${filters.companyId}`);

  const result = await db.execute(sql`
    SELECT
      t.id, t.public_id, t.company_id, t.city_id, t.driver_id, t.status,
      t.pickup_time, t.pickup_address, t.dropoff_address,
      t.auto_assign_status, t.auto_assign_failure_reason,
      t.scheduled_date,
      p.first_name || ' ' || p.last_name as patient_name,
      d.first_name || ' ' || d.last_name as driver_name,
      c.name as company_name
    FROM trips t
    LEFT JOIN patients p ON p.id = t.patient_id
    LEFT JOIN drivers d ON d.id = t.driver_id
    LEFT JOIN companies c ON c.id = t.company_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY t.pickup_time ASC
  `);

  const rows = (result as any).rows || result;
  return Array.isArray(rows) ? rows : [];
}

export async function pauseDialysisAutomation(companyId: number, actorUserId?: number) {
  await db.update(companies).set({
    zeroTouchDialysisEnabled: false,
  }).where(eq(companies.id, companyId));

  await db.insert(automationEvents).values({
    eventType: "DIALYSIS_AUTOMATION_PAUSED",
    companyId,
    actorUserId: actorUserId || null,
    payload: { pausedAt: new Date().toISOString() },
  });
}

export async function resumeDialysisAutomation(companyId: number, actorUserId?: number) {
  await db.update(companies).set({
    zeroTouchDialysisEnabled: true,
  }).where(eq(companies.id, companyId));

  await db.insert(automationEvents).values({
    eventType: "DIALYSIS_AUTOMATION_RESUMED",
    companyId,
    actorUserId: actorUserId || null,
    payload: { resumedAt: new Date().toISOString() },
  });
}

let dialysisInterval: NodeJS.Timeout | null = null;

export function startDialysisScheduler() {
  if (dialysisInterval) return;

  dialysisInterval = setInterval(async () => {
    try {
      const preAssign = await runDialysisPreAssign();
      if (preAssign.processed > 0) {
        console.log(`[DIALYSIS] Pre-assign: ${preAssign.assigned}/${preAssign.processed} assigned, ${preAssign.failed} failed`);
      }

      const recheck = await runDialysisRecheck();
      if (recheck.checked > 0) {
        console.log(`[DIALYSIS] Recheck: ${recheck.reassigned}/${recheck.checked} reassigned`);
      }
    } catch (err: any) {
      console.error(`[DIALYSIS] Scheduler error: ${err.message}`);
    }
  }, 60_000);

  console.log("[DIALYSIS] Scheduler started (checks every 60s)");
}
