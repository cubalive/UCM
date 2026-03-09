import { CronJob } from "cron";
import { getDb } from "../db/index.js";
import { trips, driverStatus as driverStatusTable } from "../db/schema.js";
import { sql, eq, and, inArray } from "drizzle-orm";
import { broadcastToRole, WS_EVENTS } from "../services/realtimeService.js";
import logger from "../lib/logger.js";

let job: CronJob | null = null;

interface StuckTripAlert {
  tripId: string;
  tenantId: string;
  status: string;
  minutesStuck: number;
  driverId: string | null;
}

export async function detectStuckTrips(): Promise<StuckTripAlert[]> {
  const db = getDb();

  // Find trips stuck in active states for too long
  const stuckTrips = await db
    .select({
      id: trips.id,
      tenantId: trips.tenantId,
      status: trips.status,
      driverId: trips.driverId,
      updatedAt: trips.updatedAt,
    })
    .from(trips)
    .where(
      and(
        inArray(trips.status, ["assigned", "en_route", "arrived"] as any),
        sql`${trips.updatedAt} < now() - interval '2 hours'`
      )
    );

  const alerts: StuckTripAlert[] = stuckTrips.map((t) => ({
    tripId: t.id,
    tenantId: t.tenantId,
    status: t.status,
    minutesStuck: Math.round((Date.now() - t.updatedAt.getTime()) / 60000),
    driverId: t.driverId,
  }));

  // Group alerts by tenant and broadcast
  const byTenant = new Map<string, StuckTripAlert[]>();
  for (const alert of alerts) {
    if (!byTenant.has(alert.tenantId)) byTenant.set(alert.tenantId, []);
    byTenant.get(alert.tenantId)!.push(alert);
  }

  for (const [tenantId, tenantAlerts] of byTenant) {
    broadcastToRole(tenantId, "dispatcher", "operational:alert", {
      type: "stuck_trips",
      count: tenantAlerts.length,
      trips: tenantAlerts.map((a) => ({
        tripId: a.tripId,
        status: a.status,
        minutesStuck: a.minutesStuck,
      })),
      message: `${tenantAlerts.length} trip(s) stuck in active state for >2 hours`,
    });
  }

  return alerts;
}

export async function detectOfflineDriversWithActiveTrips(): Promise<Array<{ driverId: string; tenantId: string; tripCount: number }>> {
  const db = getDb();

  // Find drivers who are offline but have assigned/active trips
  const problems = await db
    .select({
      driverId: driverStatusTable.driverId,
      tenantId: driverStatusTable.tenantId,
      tripCount: sql<number>`count(${trips.id})`,
    })
    .from(driverStatusTable)
    .innerJoin(trips, and(
      eq(trips.driverId, driverStatusTable.driverId),
      inArray(trips.status, ["assigned", "en_route", "arrived", "in_progress"] as any)
    ))
    .where(eq(driverStatusTable.availability, "offline"))
    .groupBy(driverStatusTable.driverId, driverStatusTable.tenantId);

  for (const problem of problems) {
    broadcastToRole(problem.tenantId, "dispatcher", "operational:alert", {
      type: "offline_driver_with_trips",
      driverId: problem.driverId,
      tripCount: Number(problem.tripCount),
      message: `Offline driver has ${problem.tripCount} active trip(s) — may need reassignment`,
    });
  }

  return problems.map((p) => ({
    driverId: p.driverId,
    tenantId: p.tenantId,
    tripCount: Number(p.tripCount),
  }));
}

export function startStuckTripDetectorJob(): CronJob {
  // Run every 15 minutes
  job = CronJob.from({
    cronTime: "*/15 * * * *",
    timeZone: "UTC",
    onTick: async () => {
      try {
        const [stuckTrips, offlineDrivers] = await Promise.all([
          detectStuckTrips(),
          detectOfflineDriversWithActiveTrips(),
        ]);

        if (stuckTrips.length > 0) {
          logger.warn("Stuck trips detected", { count: stuckTrips.length });
        }
        if (offlineDrivers.length > 0) {
          logger.warn("Offline drivers with active trips", { count: offlineDrivers.length });
        }
      } catch (err: any) {
        logger.error("Stuck trip detector failed", { error: err.message });
      }
    },
  });

  job.start();
  logger.info("Stuck trip detector job scheduled (every 15 minutes)");
  return job;
}

export function stopStuckTripDetectorJob(): void {
  if (job) {
    job.stop();
    job = null;
  }
}
