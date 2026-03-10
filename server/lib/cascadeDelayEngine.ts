import { db } from "../db";
import { trips, cascadeDelayAlerts, drivers } from "@shared/schema";
import type { CascadeDelayAlert, InsertCascadeDelayAlert } from "@shared/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { autoNotifyPatient } from "./dispatchAutoSms";
import { broadcastToTrip, broadcastToDriver } from "./realtime";

const CASCADE_DELAY_THRESHOLD_MINUTES = 10;
const MAX_CASCADE_LEVEL = 10;

/**
 * Parse a time string like "HH:MM" or "HH:MM AM/PM" into minutes since midnight.
 */
function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const normalized = time.trim().toUpperCase();

  // Try HH:MM (24h)
  const match24 = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
  }

  // Try HH:MM AM/PM
  const match12 = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const period = match12[3];
    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  return null;
}

/**
 * Detect if a trip's current ETA creates a cascade delay for subsequent trips.
 * Called after an ETA update in the ETA engine.
 */
export async function detectCascadeDelay(tripId: number): Promise<void> {
  try {
    const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
    if (!trip || !trip.driverId || !trip.scheduledDate || !trip.pickupTime) return;

    const etaMinutes = trip.lastEtaMinutes;
    if (etaMinutes == null) return;

    // Determine how late this trip is running.
    // For en-route-to-pickup trips: compare ETA to scheduled pickup time.
    // For picked-up/en-route-to-dropoff: compare ETA to estimated arrival time.
    const isPrePickup = ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "ASSIGNED"].includes(trip.status);

    let scheduledMinutes: number | null = null;
    if (isPrePickup) {
      scheduledMinutes = parseTimeToMinutes(trip.pickupTime);
    } else {
      // For post-pickup, the delay is based on how long the current trip is taking vs estimated
      // We still cascade based on ETA exceeding expected completion
      scheduledMinutes = parseTimeToMinutes(trip.estimatedArrivalTime);
    }

    if (scheduledMinutes == null) return;

    // Calculate how many minutes late based on current time + ETA vs scheduled time
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const estimatedArrivalMinutes = nowMinutes + etaMinutes;
    const delayMinutes = estimatedArrivalMinutes - scheduledMinutes;

    if (delayMinutes < CASCADE_DELAY_THRESHOLD_MINUTES) {
      // Trip is not significantly delayed — resolve any existing cascade alerts
      await resolveCascadeAlerts(tripId);
      return;
    }

    console.log(
      `[CASCADE-DELAY] Trip ${tripId} delayed by ${delayMinutes}min (threshold: ${CASCADE_DELAY_THRESHOLD_MINUTES}min). Triggering cascade recalculation.`
    );

    await recalculateDownstreamETAs(
      trip.driverId,
      trip.scheduledDate,
      delayMinutes,
      tripId,
      trip.companyId
    );
  } catch (err: any) {
    console.warn(`[CASCADE-DELAY] Error detecting cascade for trip ${tripId}: ${err.message}`);
  }
}

/**
 * For each downstream trip assigned to the same driver on the same day,
 * calculate cumulative delay and create/update alerts.
 */
export async function recalculateDownstreamETAs(
  driverId: number,
  date: string,
  delayMinutes: number,
  triggerTripId: number,
  companyId: number
): Promise<CascadeDelayAlert[]> {
  // Get all future trips for this driver on this date, ordered by pickup time
  const driverTrips = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.scheduledDate, date),
        sql`${trips.status} NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')`,
        sql`${trips.id} != ${triggerTripId}`
      )
    )
    .orderBy(trips.pickupTime);

  if (driverTrips.length === 0) return [];

  // Determine the trigger trip's pickup time for ordering
  const [triggerTrip] = await db.select().from(trips).where(eq(trips.id, triggerTripId)).limit(1);
  const triggerPickupMinutes = parseTimeToMinutes(triggerTrip?.pickupTime);
  if (triggerPickupMinutes == null) return [];

  // Filter to only downstream trips (pickup time after the trigger trip)
  const downstreamTrips = driverTrips.filter((t) => {
    const pickupMin = parseTimeToMinutes(t.pickupTime);
    return pickupMin != null && pickupMin > triggerPickupMinutes;
  });

  if (downstreamTrips.length === 0) return [];

  const createdAlerts: CascadeDelayAlert[] = [];
  let cumulativeDelay = delayMinutes;

  for (let i = 0; i < Math.min(downstreamTrips.length, MAX_CASCADE_LEVEL); i++) {
    const affectedTrip = downstreamTrips[i];
    const cascadeLevel = i + 1;
    const originalPickupMinutes = parseTimeToMinutes(affectedTrip.pickupTime);
    if (originalPickupMinutes == null) continue;

    // Check gap between trips — if there's enough gap, the delay may be absorbed
    let gapAbsorbed = 0;
    if (i === 0) {
      // Gap between trigger trip expected completion and this trip's pickup
      const triggerEstimatedEnd = triggerPickupMinutes + (triggerTrip?.durationMinutes || 30);
      gapAbsorbed = Math.max(0, originalPickupMinutes - triggerEstimatedEnd);
    } else {
      // Gap between previous downstream trip and this one
      const prevTrip = downstreamTrips[i - 1];
      const prevPickupMinutes = parseTimeToMinutes(prevTrip.pickupTime) || 0;
      const prevDuration = prevTrip.durationMinutes || 30;
      gapAbsorbed = Math.max(0, originalPickupMinutes - (prevPickupMinutes + prevDuration));
    }

    cumulativeDelay = Math.max(0, cumulativeDelay - gapAbsorbed);
    if (cumulativeDelay <= 0) break; // Delay fully absorbed by gap

    const newEtaMinutes = originalPickupMinutes + cumulativeDelay;
    const originalEtaMinutes = originalPickupMinutes;

    // Upsert: check if alert already exists for this trigger+affected pair
    const existing = await db
      .select()
      .from(cascadeDelayAlerts)
      .where(
        and(
          eq(cascadeDelayAlerts.triggerTripId, triggerTripId),
          eq(cascadeDelayAlerts.affectedTripId, affectedTrip.id),
          eq(cascadeDelayAlerts.status, "active")
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing alert
      await db
        .update(cascadeDelayAlerts)
        .set({
          delayMinutes: cumulativeDelay,
          newEtaMinutes,
          cascadeLevel,
        })
        .where(eq(cascadeDelayAlerts.id, existing[0].id));
      createdAlerts.push({ ...existing[0], delayMinutes: cumulativeDelay, newEtaMinutes, cascadeLevel });
    } else {
      // Create new alert
      const [alert] = await db
        .insert(cascadeDelayAlerts)
        .values({
          triggerTripId,
          affectedTripId: affectedTrip.id,
          driverId,
          companyId,
          originalEtaMinutes,
          newEtaMinutes,
          delayMinutes: cumulativeDelay,
          cascadeLevel,
          alertType: "in_app",
          status: "active",
        })
        .returning();
      createdAlerts.push(alert);
    }
  }

  // Send alerts for newly created ones
  if (createdAlerts.length > 0) {
    await sendCascadeAlerts(createdAlerts);
  }

  return createdAlerts;
}

/**
 * Send notifications for cascade delay alerts.
 * - SMS to affected patients
 * - WebSocket to dispatch and driver
 */
export async function sendCascadeAlerts(alerts: CascadeDelayAlert[]): Promise<void> {
  for (const alert of alerts) {
    try {
      // Skip if alert already sent
      if (alert.alertSentAt) continue;

      // Send SMS notification to the patient of the affected trip
      await autoNotifyPatient(alert.affectedTripId, "cascade_delay", {
        eta_minutes: alert.delayMinutes,
      });

      // Broadcast real-time update to the affected trip's watchers
      broadcastToTrip(alert.affectedTripId, {
        type: "cascade_delay",
        data: {
          triggerTripId: alert.triggerTripId,
          delayMinutes: alert.delayMinutes,
          cascadeLevel: alert.cascadeLevel,
          newEtaMinutes: alert.newEtaMinutes,
        },
      });

      // Broadcast to driver
      broadcastToDriver(alert.driverId, {
        type: "cascade_delay",
        data: {
          affectedTripId: alert.affectedTripId,
          delayMinutes: alert.delayMinutes,
          cascadeLevel: alert.cascadeLevel,
          totalAffected: alerts.length,
        },
      });

      // Mark alert as sent
      await db
        .update(cascadeDelayAlerts)
        .set({
          alertSentAt: new Date(),
          alertType: "sms",
        })
        .where(eq(cascadeDelayAlerts.id, alert.id));

      console.log(
        `[CASCADE-DELAY] Alert sent for trip ${alert.affectedTripId} (cascade level ${alert.cascadeLevel}, delay ${alert.delayMinutes}min)`
      );
    } catch (err: any) {
      console.warn(
        `[CASCADE-DELAY] Failed to send alert for trip ${alert.affectedTripId}: ${err.message}`
      );
    }
  }
}

/**
 * Resolve cascade alerts when a delayed trip completes or delay is no longer present.
 */
export async function resolveCascadeAlerts(tripId: number): Promise<number> {
  try {
    const result = await db
      .update(cascadeDelayAlerts)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(cascadeDelayAlerts.triggerTripId, tripId),
          eq(cascadeDelayAlerts.status, "active")
        )
      )
      .returning();

    if (result.length > 0) {
      console.log(`[CASCADE-DELAY] Resolved ${result.length} cascade alerts for trigger trip ${tripId}`);

      // Broadcast resolution to each affected trip
      for (const alert of result) {
        broadcastToTrip(alert.affectedTripId, {
          type: "cascade_delay_resolved",
          data: {
            triggerTripId: tripId,
            alertId: alert.id,
          },
        });
      }
    }

    return result.length;
  } catch (err: any) {
    console.warn(`[CASCADE-DELAY] Error resolving alerts for trip ${tripId}: ${err.message}`);
    return 0;
  }
}

/**
 * Get all active cascade delays for a driver on a given date.
 */
export async function getCascadeDelayStatus(
  driverId: number,
  date: string
): Promise<CascadeDelayAlert[]> {
  // Join with trips to filter by date
  const alerts = await db
    .select({
      alert: cascadeDelayAlerts,
    })
    .from(cascadeDelayAlerts)
    .innerJoin(trips, eq(cascadeDelayAlerts.affectedTripId, trips.id))
    .where(
      and(
        eq(cascadeDelayAlerts.driverId, driverId),
        eq(cascadeDelayAlerts.status, "active"),
        eq(trips.scheduledDate, date)
      )
    )
    .orderBy(cascadeDelayAlerts.cascadeLevel);

  return alerts.map((r) => r.alert);
}

/**
 * Get all active cascade alerts for a company.
 */
export async function getActiveCascadeAlertsForCompany(
  companyId: number
): Promise<CascadeDelayAlert[]> {
  return db
    .select()
    .from(cascadeDelayAlerts)
    .where(
      and(
        eq(cascadeDelayAlerts.companyId, companyId),
        eq(cascadeDelayAlerts.status, "active")
      )
    )
    .orderBy(desc(cascadeDelayAlerts.createdAt));
}

/**
 * Get dashboard summary stats for cascade alerts.
 */
export async function getCascadeAlertsDashboard(companyId: number): Promise<{
  activeAlerts: number;
  resolvedToday: number;
  avgDelayMinutes: number;
  mostAffectedDriverId: number | null;
  totalAlertsToday: number;
}> {
  const today = new Date().toISOString().split("T")[0];

  const [activeResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(cascadeDelayAlerts)
    .where(
      and(
        eq(cascadeDelayAlerts.companyId, companyId),
        eq(cascadeDelayAlerts.status, "active")
      )
    );

  const [resolvedTodayResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(cascadeDelayAlerts)
    .where(
      and(
        eq(cascadeDelayAlerts.companyId, companyId),
        eq(cascadeDelayAlerts.status, "resolved"),
        sql`DATE(${cascadeDelayAlerts.resolvedAt}) = ${today}::date`
      )
    );

  const [avgDelayResult] = await db
    .select({ avg: sql<number>`COALESCE(AVG(${cascadeDelayAlerts.delayMinutes}), 0)` })
    .from(cascadeDelayAlerts)
    .where(
      and(
        eq(cascadeDelayAlerts.companyId, companyId),
        eq(cascadeDelayAlerts.status, "active")
      )
    );

  const [mostAffectedResult] = await db
    .select({
      driverId: cascadeDelayAlerts.driverId,
      count: sql<number>`count(*)`,
    })
    .from(cascadeDelayAlerts)
    .where(
      and(
        eq(cascadeDelayAlerts.companyId, companyId),
        eq(cascadeDelayAlerts.status, "active")
      )
    )
    .groupBy(cascadeDelayAlerts.driverId)
    .orderBy(sql`count(*) DESC`)
    .limit(1);

  const [totalTodayResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(cascadeDelayAlerts)
    .where(
      and(
        eq(cascadeDelayAlerts.companyId, companyId),
        sql`DATE(${cascadeDelayAlerts.createdAt}) = ${today}::date`
      )
    );

  return {
    activeAlerts: Number(activeResult?.count || 0),
    resolvedToday: Number(resolvedTodayResult?.count || 0),
    avgDelayMinutes: Math.round(Number(avgDelayResult?.avg || 0)),
    mostAffectedDriverId: mostAffectedResult?.driverId || null,
    totalAlertsToday: Number(totalTodayResult?.count || 0),
  };
}

/**
 * Acknowledge a cascade delay alert (dispatch marks it as seen).
 */
export async function acknowledgeCascadeAlert(alertId: number): Promise<CascadeDelayAlert | null> {
  const [updated] = await db
    .update(cascadeDelayAlerts)
    .set({
      alertSentAt: new Date(), // mark as acknowledged by updating alertSentAt
    })
    .where(eq(cascadeDelayAlerts.id, alertId))
    .returning();

  return updated || null;
}
