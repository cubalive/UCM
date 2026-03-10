import { db } from "../db";
import { trips } from "@shared/schema";
import { sql } from "drizzle-orm";

export interface StuckTrip {
  tripId: number;
  publicId: string;
  companyId: number;
  cityId: number;
  status: string;
  driverId: number | null;
  stuckSinceMinutes: number;
  reason: string;
  severity: "warning" | "critical";
}

/**
 * Detect trips stuck in intermediate states for too long.
 *
 * Thresholds:
 *   - ASSIGNED but not started after 30 min
 *   - EN_ROUTE_TO_PICKUP but not arrived after estimated ETA + 15 min (min 30 min)
 *   - ARRIVED_PICKUP but not picked up after 20 min
 */
export async function detectStuckTrips(companyId?: number): Promise<StuckTrip[]> {
  const companyFilter = companyId ? sql`AND t.company_id = ${companyId}` : sql``;

  const result = await db.execute(sql`
    SELECT
      t.id,
      t.public_id,
      t.company_id,
      t.city_id,
      t.status,
      t.driver_id,
      t.assigned_at,
      t.started_at,
      t.arrived_pickup_at,
      t.last_eta_minutes,
      t.updated_at,
      CASE
        WHEN t.status = 'ASSIGNED' AND t.assigned_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (NOW() - t.assigned_at)) / 60.0
        WHEN t.status = 'EN_ROUTE_TO_PICKUP' AND t.started_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (NOW() - t.started_at)) / 60.0
        WHEN t.status = 'ARRIVED_PICKUP' AND t.arrived_pickup_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (NOW() - t.arrived_pickup_at)) / 60.0
        ELSE EXTRACT(EPOCH FROM (NOW() - COALESCE(t.updated_at, t.created_at))) / 60.0
      END AS minutes_in_state
    FROM ${trips} t
    WHERE t.deleted_at IS NULL
    AND t.status IN ('ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_PICKUP')
    ${companyFilter}
    AND (
      (t.status = 'ASSIGNED'
        AND t.assigned_at IS NOT NULL
        AND t.assigned_at < NOW() - INTERVAL '30 minutes')
      OR
      (t.status = 'EN_ROUTE_TO_PICKUP'
        AND t.started_at IS NOT NULL
        AND t.started_at < NOW() - (COALESCE(t.last_eta_minutes, 15) + 15) * INTERVAL '1 minute')
      OR
      (t.status = 'ARRIVED_PICKUP'
        AND t.arrived_pickup_at IS NOT NULL
        AND t.arrived_pickup_at < NOW() - INTERVAL '20 minutes')
    )
    ORDER BY minutes_in_state DESC
  `);

  const rows = (result as any).rows || [];

  return rows.map((r: any): StuckTrip => {
    const minutesInState = Math.round(Number(r.minutes_in_state));
    let reason: string;
    let severity: "warning" | "critical";

    switch (r.status) {
      case "ASSIGNED":
        reason = `Trip has been ASSIGNED for ${minutesInState} min without driver starting en route (threshold: 30 min)`;
        severity = minutesInState > 60 ? "critical" : "warning";
        break;
      case "EN_ROUTE_TO_PICKUP": {
        const etaThreshold = (Number(r.last_eta_minutes) || 15) + 15;
        reason = `Trip has been EN_ROUTE_TO_PICKUP for ${minutesInState} min without arrival (threshold: ETA ${Number(r.last_eta_minutes) || 15} + 15 = ${etaThreshold} min)`;
        severity = minutesInState > etaThreshold * 2 ? "critical" : "warning";
        break;
      }
      case "ARRIVED_PICKUP":
        reason = `Trip has been at ARRIVED_PICKUP for ${minutesInState} min without pickup (threshold: 20 min)`;
        severity = minutesInState > 40 ? "critical" : "warning";
        break;
      default:
        reason = `Trip stuck in ${r.status} for ${minutesInState} min`;
        severity = "warning";
    }

    return {
      tripId: r.id,
      publicId: r.public_id,
      companyId: r.company_id,
      cityId: r.city_id,
      status: r.status,
      driverId: r.driver_id,
      stuckSinceMinutes: minutesInState,
      reason,
      severity,
    };
  });
}

let monitorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start a background monitor that checks for stuck trips every 5 minutes.
 * Logs alerts and broadcasts via WebSocket to company subscribers.
 */
export function startStuckTripMonitor(): void {
  if (monitorInterval) {
    console.log("[StuckTripDetector] Monitor already running");
    return;
  }

  const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  async function runCheck() {
    try {
      const stuckTrips = await detectStuckTrips();

      if (stuckTrips.length === 0) return;

      console.log(`[StuckTripDetector] Found ${stuckTrips.length} stuck trip(s)`);

      // Group by company for broadcast
      const byCompany = new Map<number, StuckTrip[]>();
      for (const trip of stuckTrips) {
        const list = byCompany.get(trip.companyId) || [];
        list.push(trip);
        byCompany.set(trip.companyId, list);
      }

      // Log each stuck trip
      for (const trip of stuckTrips) {
        const level = trip.severity === "critical" ? "error" : "warn";
        console[level](
          `[StuckTripDetector] [${trip.severity.toUpperCase()}] Trip ${trip.publicId}: ${trip.reason}`,
        );
      }

      // Broadcast alerts via WebSocket
      try {
        const { broadcastCompanyTripUpdate } = require("./tripTransitionHelper");
        for (const [companyId, companyTrips] of byCompany) {
          broadcastCompanyTripUpdate(companyId, {
            type: "STUCK_TRIPS_ALERT",
            stuckTrips: companyTrips.map((t) => ({
              tripId: t.tripId,
              publicId: t.publicId,
              status: t.status,
              stuckSinceMinutes: t.stuckSinceMinutes,
              reason: t.reason,
              severity: t.severity,
            })),
            count: companyTrips.length,
            timestamp: new Date().toISOString(),
          });
        }
      } catch {
        // WebSocket broadcast is best-effort
      }
    } catch (err: any) {
      console.error(`[StuckTripDetector] Check failed: ${err.message}`);
    }
  }

  // Run initial check after short delay to let server boot
  setTimeout(runCheck, 10_000);

  monitorInterval = setInterval(runCheck, INTERVAL_MS);
  console.log("[StuckTripDetector] Monitor started (interval: 5 min)");
}

export function stopStuckTripMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log("[StuckTripDetector] Monitor stopped");
  }
}

export function isStuckTripMonitorRunning(): boolean {
  return monitorInterval !== null;
}
