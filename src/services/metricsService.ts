import { getDb } from "../db/index.js";
import { trips, users, driverStatus, invoices, webhookEvents } from "../db/schema.js";
import { sql } from "drizzle-orm";
import { checkDbHealth } from "../db/index.js";
import { checkRedisHealth } from "../lib/redis.js";
import { getConnectedStats } from "./realtimeService.js";

export interface SystemMetrics {
  timestamp: string;
  uptime: number;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
  };
  infrastructure: {
    database: { status: string; latencyMs: number };
    redis: { status: string; latencyMs: number };
    websocket: { connections: number; onlineDrivers: number; byRole: Record<string, number> };
  };
  trips: {
    requested: number;
    assigned: number;
    enRoute: number;
    arrived: number;
    inProgress: number;
    completedToday: number;
    cancelledToday: number;
    stuck: number;
    avgCompletionMinutes: number | null;
  };
  drivers: {
    total: number;
    available: number;
    busy: number;
    offline: number;
    onBreak: number;
    onlineWs: number;
    staleLocation: number;
  };
  billing: {
    pendingInvoices: number;
    overdueInvoices: number;
    failedWebhooks: number;
    deadLetterWebhooks: number;
  };
  alerts: Array<{ level: "info" | "warning" | "critical"; message: string; metric: string }>;
}

export async function collectMetrics(): Promise<SystemMetrics> {
  const db = getDb();
  const now = new Date();

  // Run all DB queries in parallel
  const [dbHealth, redisHealth, tripStats, driverStats, billingStats] = await Promise.all([
    checkDbHealth(),
    checkRedisHealth(),

    // Trip pipeline stats
    db.select({
      requested: sql<number>`count(case when status = 'requested' then 1 end)`,
      assigned: sql<number>`count(case when status = 'assigned' then 1 end)`,
      en_route: sql<number>`count(case when status = 'en_route' then 1 end)`,
      arrived: sql<number>`count(case when status = 'arrived' then 1 end)`,
      in_progress: sql<number>`count(case when status = 'in_progress' then 1 end)`,
      completed_today: sql<number>`count(case when status = 'completed' and completed_at > now() - interval '24 hours' then 1 end)`,
      cancelled_today: sql<number>`count(case when status = 'cancelled' and updated_at > now() - interval '24 hours' then 1 end)`,
      stuck: sql<number>`count(case when status in ('assigned', 'en_route', 'arrived') and updated_at < now() - interval '2 hours' then 1 end)`,
      avg_completion_minutes: sql<number>`avg(extract(epoch from (completed_at - started_at)) / 60) filter (where status = 'completed' and completed_at > now() - interval '24 hours' and started_at is not null)`,
    }).from(trips),

    // Driver availability breakdown
    db.select({
      availability: driverStatus.availability,
      count: sql<number>`count(*)`,
      stale: sql<number>`count(case when last_location_at < now() - interval '15 minutes' or last_location_at is null then 1 end)`,
    }).from(driverStatus).groupBy(driverStatus.availability),

    // Billing health
    db.select({
      pending_invoices: sql<number>`count(case when status in ('pending', 'sent') then 1 end)`,
      overdue_invoices: sql<number>`count(case when status = 'overdue' then 1 end)`,
    }).from(invoices),
  ]);

  // Webhook stats (separate query)
  const webhookStats = await db.select({
    failed: sql<number>`count(case when status = 'failed' then 1 end)`,
    dead_letter: sql<number>`count(case when status = 'dead_letter' then 1 end)`,
  }).from(webhookEvents);

  const wsStats = getConnectedStats();
  const mem = process.memoryUsage();

  const trip = tripStats[0];
  const stuckCount = Number(trip?.stuck || 0);
  const requestedCount = Number(trip?.requested || 0);

  // Build driver breakdown
  const driverBreakdown: Record<string, number> = { available: 0, busy: 0, offline: 0, break: 0 };
  let totalDrivers = 0;
  let staleLocation = 0;
  for (const ds of driverStats) {
    const count = Number(ds.count);
    driverBreakdown[ds.availability] = count;
    totalDrivers += count;
    staleLocation += Number(ds.stale);
  }

  // Generate alerts
  const alerts: SystemMetrics["alerts"] = [];

  if (stuckCount > 0) {
    alerts.push({ level: stuckCount > 5 ? "critical" : "warning", message: `${stuckCount} trip(s) stuck >2h`, metric: "trips.stuck" });
  }
  if (requestedCount > 20) {
    alerts.push({ level: "critical", message: `${requestedCount} unassigned trips in queue`, metric: "trips.requested" });
  } else if (requestedCount > 10) {
    alerts.push({ level: "warning", message: `${requestedCount} unassigned trips in queue`, metric: "trips.requested" });
  }
  if (driverBreakdown.available === 0 && totalDrivers > 0) {
    alerts.push({ level: "warning", message: "No drivers available", metric: "drivers.available" });
  }
  if (staleLocation > 3) {
    alerts.push({ level: "info", message: `${staleLocation} drivers with stale location`, metric: "drivers.staleLocation" });
  }
  if (!dbHealth.connected) {
    alerts.push({ level: "critical", message: "Database connection down", metric: "infrastructure.database" });
  }
  if (!redisHealth.connected) {
    alerts.push({ level: "warning", message: "Redis connection down", metric: "infrastructure.redis" });
  }
  if (Number(webhookStats[0]?.failed || 0) > 0) {
    alerts.push({ level: "warning", message: `${webhookStats[0].failed} failed webhooks`, metric: "billing.failedWebhooks" });
  }
  if (Number(webhookStats[0]?.dead_letter || 0) > 0) {
    alerts.push({ level: "critical", message: `${webhookStats[0].dead_letter} dead-letter webhooks`, metric: "billing.deadLetterWebhooks" });
  }

  const avgCompletion = trip?.avg_completion_minutes ? Math.round(Number(trip.avg_completion_minutes)) : null;

  return {
    timestamp: now.toISOString(),
    uptime: process.uptime(),
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1048576),
      heapTotalMB: Math.round(mem.heapTotal / 1048576),
      rssMB: Math.round(mem.rss / 1048576),
    },
    infrastructure: {
      database: { status: dbHealth.connected ? "up" : "down", latencyMs: dbHealth.latencyMs ?? 0 },
      redis: { status: redisHealth.connected ? "up" : "down", latencyMs: redisHealth.latencyMs ?? 0 },
      websocket: {
        connections: wsStats.totalConnections,
        onlineDrivers: wsStats.onlineDrivers,
        byRole: wsStats.byRole || {},
      },
    },
    trips: {
      requested: Number(trip?.requested || 0),
      assigned: Number(trip?.assigned || 0),
      enRoute: Number(trip?.en_route || 0),
      arrived: Number(trip?.arrived || 0),
      inProgress: Number(trip?.in_progress || 0),
      completedToday: Number(trip?.completed_today || 0),
      cancelledToday: Number(trip?.cancelled_today || 0),
      stuck: stuckCount,
      avgCompletionMinutes: avgCompletion,
    },
    drivers: {
      total: totalDrivers,
      available: driverBreakdown.available,
      busy: driverBreakdown.busy,
      offline: driverBreakdown.offline,
      onBreak: driverBreakdown.break,
      onlineWs: wsStats.onlineDrivers,
      staleLocation,
    },
    billing: {
      pendingInvoices: Number(billingStats[0]?.pending_invoices || 0),
      overdueInvoices: Number(billingStats[0]?.overdue_invoices || 0),
      failedWebhooks: Number(webhookStats[0]?.failed || 0),
      deadLetterWebhooks: Number(webhookStats[0]?.dead_letter || 0),
    },
    alerts,
  };
}

// Prometheus-compatible text format
export function metricsToPrometheus(m: SystemMetrics): string {
  const lines: string[] = [];

  function gauge(name: string, help: string, value: number, labels?: Record<string, string>) {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    const labelStr = labels ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",")}}` : "";
    lines.push(`${name}${labelStr} ${value}`);
  }

  gauge("ucm_uptime_seconds", "Process uptime in seconds", Math.round(m.uptime));
  gauge("ucm_memory_heap_used_bytes", "Heap memory used", m.memory.heapUsedMB * 1048576);
  gauge("ucm_memory_rss_bytes", "Resident set size", m.memory.rssMB * 1048576);

  gauge("ucm_db_up", "Database connection status", m.infrastructure.database.status === "up" ? 1 : 0);
  gauge("ucm_db_latency_ms", "Database latency in ms", m.infrastructure.database.latencyMs);
  gauge("ucm_redis_up", "Redis connection status", m.infrastructure.redis.status === "up" ? 1 : 0);
  gauge("ucm_redis_latency_ms", "Redis latency in ms", m.infrastructure.redis.latencyMs);
  gauge("ucm_websocket_connections", "WebSocket connections", m.infrastructure.websocket.connections);

  gauge("ucm_trips_requested", "Trips in requested status", m.trips.requested);
  gauge("ucm_trips_assigned", "Trips in assigned status", m.trips.assigned);
  gauge("ucm_trips_en_route", "Trips in en_route status", m.trips.enRoute);
  gauge("ucm_trips_in_progress", "Trips in in_progress status", m.trips.inProgress);
  gauge("ucm_trips_completed_today", "Trips completed in last 24h", m.trips.completedToday);
  gauge("ucm_trips_cancelled_today", "Trips cancelled in last 24h", m.trips.cancelledToday);
  gauge("ucm_trips_stuck", "Trips stuck >2h in active state", m.trips.stuck);
  if (m.trips.avgCompletionMinutes !== null) {
    gauge("ucm_trips_avg_completion_minutes", "Average trip completion time (minutes)", m.trips.avgCompletionMinutes);
  }

  gauge("ucm_drivers_total", "Total registered drivers", m.drivers.total);
  gauge("ucm_drivers_available", "Available drivers", m.drivers.available);
  gauge("ucm_drivers_busy", "Busy drivers", m.drivers.busy);
  gauge("ucm_drivers_online_ws", "Drivers connected via WebSocket", m.drivers.onlineWs);
  gauge("ucm_drivers_stale_location", "Drivers with stale location >15m", m.drivers.staleLocation);

  gauge("ucm_invoices_pending", "Pending/sent invoices", m.billing.pendingInvoices);
  gauge("ucm_invoices_overdue", "Overdue invoices", m.billing.overdueInvoices);
  gauge("ucm_webhooks_failed", "Failed webhook events", m.billing.failedWebhooks);
  gauge("ucm_webhooks_dead_letter", "Dead-letter webhook events", m.billing.deadLetterWebhooks);

  gauge("ucm_alerts_total", "Number of active alerts", m.alerts.length);

  return lines.join("\n") + "\n";
}
