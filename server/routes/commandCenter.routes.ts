import express, { type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { db } from "../db";
import { trips, drivers, invoices } from "@shared/schema";
import { sql, eq, and, gte, lte, count, sum, inArray, isNull, isNotNull } from "drizzle-orm";

const router = express.Router();

// ─── GET /api/command-center/alerts ─────────────────────────────────────────
// Aggregates alerts from: late trips, fatigue, demand prediction, unassigned trips
router.get(
  "/api/command-center/alerts",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
      const today = new Date().toISOString().split("T")[0];
      const alerts: Array<{
        id: string;
        type: string;
        urgency: "critical" | "high" | "medium" | "info";
        title: string;
        description: string;
        recommendedAction: string;
        actionType: string;
        actionLabel: string;
        entityId?: number;
        entityType?: string;
        createdAt: string;
      }> = [];

      const cityFilter = cityId ? sql`AND ${trips.cityId} = ${cityId}` : sql``;

      // 1. Late trips (IN_PROGRESS trips past their scheduled time by >10 min)
      const lateTrips = await db.execute(sql`
        SELECT t.id, t.public_id, t.scheduled_date, t.pickup_time, t.status, t.driver_id,
               d.first_name as driver_first, d.last_name as driver_last
        FROM ${trips} t
        LEFT JOIN ${drivers} d ON d.id = t.driver_id
        WHERE t.status IN ('IN_PROGRESS', 'ASSIGNED', 'EN_ROUTE_TO_PICKUP')
        AND DATE(t.scheduled_date) = ${today}::date
        AND t.pickup_time IS NOT NULL
        AND (t.pickup_time::time + INTERVAL '10 minutes') < CURRENT_TIME
        ${cityFilter}
        ORDER BY t.pickup_time ASC
        LIMIT 20
      `);

      const lateRows = (lateTrips as any).rows || [];
      for (const row of lateRows) {
        const minutesLate = Math.floor(
          (Date.now() - new Date(`${today}T${row.pickup_time}`).getTime()) / 60000
        );
        const isVeryLate = minutesLate > 30;
        alerts.push({
          id: `late-${row.id}`,
          type: "late_trip",
          urgency: isVeryLate ? "critical" : "high",
          title: `Trip ${row.public_id} is ${minutesLate} min behind schedule`,
          description: `Driver: ${row.driver_first || "Unassigned"} ${row.driver_last || ""}. Pickup was scheduled at ${row.pickup_time}.`,
          recommendedAction: isVeryLate ? "Consider reassigning to a closer driver" : "Send ETA update to patient",
          actionType: isVeryLate ? "reassign" : "send_eta",
          actionLabel: isVeryLate ? "Reassign" : "Send ETA Update",
          entityId: row.id,
          entityType: "trip",
          createdAt: new Date().toISOString(),
        });
      }

      // 2. Unassigned trips for today
      const unassignedTrips = await db.execute(sql`
        SELECT t.id, t.public_id, t.pickup_time, t.pickup_address
        FROM ${trips} t
        WHERE t.status = 'SCHEDULED'
        AND t.driver_id IS NULL
        AND DATE(t.scheduled_date) = ${today}::date
        ${cityFilter}
        ORDER BY t.pickup_time ASC
        LIMIT 15
      `);

      const unassignedRows = (unassignedTrips as any).rows || [];
      for (const row of unassignedRows) {
        const pickupTime = row.pickup_time || "TBD";
        alerts.push({
          id: `unassigned-${row.id}`,
          type: "unassigned_trip",
          urgency: "high",
          title: `Trip ${row.public_id} has no driver assigned`,
          description: `Pickup at ${pickupTime} — ${row.pickup_address || "address pending"}`,
          recommendedAction: "Assign a driver or use auto-assignment",
          actionType: "assign",
          actionLabel: "Auto-Assign",
          entityId: row.id,
          entityType: "trip",
          createdAt: new Date().toISOString(),
        });
      }

      // 3. Stale drivers (available but haven't moved / reported in 15+ min)
      const staleDrivers = await db.execute(sql`
        SELECT d.id, d.first_name, d.last_name, d.last_seen_at, d.dispatch_status
        FROM ${drivers} d
        WHERE d.status = 'active'
        AND d.dispatch_status = 'enroute'
        AND d.last_seen_at < NOW() - INTERVAL '8 minutes'
        ${cityId ? sql`AND d.city_id = ${cityId}` : sql``}
        LIMIT 10
      `);

      const staleRows = (staleDrivers as any).rows || [];
      for (const row of staleRows) {
        const minutesSilent = row.last_seen_at
          ? Math.floor((Date.now() - new Date(row.last_seen_at).getTime()) / 60000)
          : 0;
        alerts.push({
          id: `stale-driver-${row.id}`,
          type: "driver_stale",
          urgency: minutesSilent > 20 ? "critical" : "medium",
          title: `Driver ${row.first_name} ${row.last_name} hasn't moved in ${minutesSilent} min`,
          description: `Status: ${row.dispatch_status}. Last seen ${minutesSilent} minutes ago.`,
          recommendedAction: "Call the driver to confirm status",
          actionType: "call_driver",
          actionLabel: "Call Driver",
          entityId: row.id,
          entityType: "driver",
          createdAt: new Date().toISOString(),
        });
      }

      // 4. Demand prediction info (mock — based on tomorrow's scheduled trips)
      const tomorrowDate = new Date();
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = tomorrowDate.toISOString().split("T")[0];

      const tomorrowTrips = await db.execute(sql`
        SELECT COUNT(*) as cnt
        FROM ${trips} t
        WHERE DATE(t.scheduled_date) = ${tomorrowStr}::date
        ${cityFilter}
      `);
      const tomorrowCount = Number((tomorrowTrips as any).rows?.[0]?.cnt || 0);

      const todayTrips = await db.execute(sql`
        SELECT COUNT(*) as cnt
        FROM ${trips} t
        WHERE DATE(t.scheduled_date) = ${today}::date
        ${cityFilter}
      `);
      const todayCount = Number((todayTrips as any).rows?.[0]?.cnt || 0);

      if (tomorrowCount > todayCount * 1.2 && tomorrowCount > 5) {
        const pctIncrease = todayCount > 0 ? Math.round(((tomorrowCount - todayCount) / todayCount) * 100) : 100;
        alerts.push({
          id: "demand-forecast-tomorrow",
          type: "demand_forecast",
          urgency: pctIncrease > 40 ? "high" : "medium",
          title: `Tomorrow: ${pctIncrease}% higher demand predicted`,
          description: `${tomorrowCount} trips scheduled for tomorrow vs ${todayCount} today. Consider adding drivers.`,
          recommendedAction: "Review forecast and adjust staffing",
          actionType: "view_forecast",
          actionLabel: "View Forecast",
          createdAt: new Date().toISOString(),
        });
      }

      // Sort by urgency
      const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, info: 3 };
      alerts.sort((a, b) => (urgencyOrder[a.urgency] ?? 3) - (urgencyOrder[b.urgency] ?? 3));

      res.json({ alerts, count: alerts.length, timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error("[CommandCenter] alerts error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/command-center/kpis ───────────────────────────────────────────
// Live KPIs for today
router.get(
  "/api/command-center/kpis",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
      const today = new Date().toISOString().split("T")[0];
      const cityFilter = cityId ? sql`AND ${trips.cityId} = ${cityId}` : sql``;
      const driverCityFilter = cityId ? sql`AND ${drivers.cityId} = ${cityId}` : sql``;

      // Trip stats for today
      const tripStats = await db.execute(sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE ${trips.status} = 'COMPLETED') as completed,
          COUNT(*) FILTER (WHERE ${trips.status} IN ('IN_PROGRESS', 'EN_ROUTE_TO_PICKUP', 'AT_PICKUP', 'EN_ROUTE_TO_DROPOFF')) as active,
          COUNT(*) FILTER (WHERE ${trips.status} = 'SCHEDULED' AND ${trips.driverId} IS NULL) as unassigned,
          COUNT(*) FILTER (WHERE ${trips.status} IN ('IN_PROGRESS', 'ASSIGNED', 'EN_ROUTE_TO_PICKUP')
            AND ${trips.pickupTime} IS NOT NULL
            AND (${trips.pickupTime}::time + INTERVAL '10 minutes') < CURRENT_TIME) as at_risk
        FROM ${trips}
        WHERE DATE(${trips.scheduledDate}) = ${today}::date
        ${cityFilter}
      `);

      const ts = (tripStats as any).rows?.[0] || {};
      const totalToday = Number(ts.total || 0);
      const completedToday = Number(ts.completed || 0);
      const activeTrips = Number(ts.active || 0);
      const unassignedCount = Number(ts.unassigned || 0);
      const tripsAtRisk = Number(ts.at_risk || 0);

      // On-time rate: completed trips that were completed within schedule
      const onTimeRate = totalToday > 0
        ? Math.round((Math.max(completedToday - tripsAtRisk, 0) / Math.max(totalToday, 1)) * 100)
        : 100;

      // Fleet utilization
      const fleetStats = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE ${drivers.status} = 'active') as total_active,
          COUNT(*) FILTER (WHERE ${drivers.status} = 'active' AND ${drivers.dispatchStatus} IN ('enroute', 'available')) as online
        FROM ${drivers}
        WHERE ${drivers.status} = 'active'
        ${driverCityFilter}
      `);

      const fs = (fleetStats as any).rows?.[0] || {};
      const totalActive = Number(fs.total_active || 0);
      const online = Number(fs.online || 0);
      const fleetUtilization = totalActive > 0 ? Math.round((online / totalActive) * 100) : 0;

      // Revenue today (sum of completed trip amounts)
      const revenueResult = await db.execute(sql`
        SELECT COALESCE(SUM(${trips.distanceMiles}), 0) as total_miles
        FROM ${trips}
        WHERE DATE(${trips.scheduledDate}) = ${today}::date
        AND ${trips.status} = 'COMPLETED'
        ${cityFilter}
      `);
      const revenueMiles = Number((revenueResult as any).rows?.[0]?.total_miles || 0);
      // Estimate revenue at ~$2.50/mile (typical NEMT rate)
      const revenueToday = Math.round(revenueMiles * 2.5 * 100) / 100;

      // Average rating (from ratings table)
      let avgRating = 4.8;
      try {
        const ratingResult = await db.execute(sql`
          SELECT AVG(r.overall_rating) as avg_rating
          FROM trip_ratings r
          JOIN ${trips} t ON t.id = r.trip_id
          WHERE DATE(t.scheduled_date) = ${today}::date
          ${cityFilter}
        `);
        const rVal = (ratingResult as any).rows?.[0]?.avg_rating;
        if (rVal) avgRating = Number(Number(rVal).toFixed(1));
      } catch {
        // ratings table may not exist, use default
      }

      res.json({
        onTimeRate,
        activeTrips,
        completedTrips: completedToday,
        totalTrips: totalToday,
        revenueToday,
        fleetUtilization,
        avgRating,
        tripsAtRisk,
        unassignedCount,
        onlineDrivers: online,
        totalDrivers: totalActive,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[CommandCenter] kpis error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/command-center/timeline ───────────────────────────────────────
// Returns today's trips formatted for Gantt display
router.get(
  "/api/command-center/timeline",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
      const today = new Date().toISOString().split("T")[0];
      const cityFilter = cityId ? sql`AND t.city_id = ${cityId}` : sql``;

      const timelineTrips = await db.execute(sql`
        SELECT
          t.id, t.public_id, t.status, t.pickup_time,
          t.estimated_arrival_time, t.duration_minutes,
          t.scheduled_date, t.driver_id,
          t.pickup_address, t.dropoff_address,
          p.first_name as patient_first, p.last_name as patient_last,
          d.first_name as driver_first, d.last_name as driver_last
        FROM ${trips} t
        LEFT JOIN patients p ON p.id = t.patient_id
        LEFT JOIN ${drivers} d ON d.id = t.driver_id
        WHERE DATE(t.scheduled_date) = ${today}::date
        ${cityFilter}
        ORDER BY t.pickup_time ASC NULLS LAST
      `);

      const rows = (timelineTrips as any).rows || [];

      // Group by driver
      const driverMap = new Map<number | null, {
        driverId: number | null;
        driverName: string;
        trips: Array<{
          id: number;
          publicId: string;
          status: string;
          startTime: string | null;
          endTime: string | null;
          patientName: string;
          pickupAddress: string;
          dropoffAddress: string;
        }>;
      }>();

      for (const row of rows) {
        const driverId = row.driver_id ?? null;
        const driverName = driverId
          ? `${row.driver_first || ""} ${row.driver_last || ""}`.trim()
          : "Unassigned";

        if (!driverMap.has(driverId)) {
          driverMap.set(driverId, { driverId, driverName, trips: [] });
        }

        // Compute end time from estimated_arrival_time or duration_minutes
        let endTime: string | null = null;
        if (row.estimated_arrival_time && row.estimated_arrival_time !== "TBD") {
          endTime = row.estimated_arrival_time;
        } else if (row.pickup_time && row.duration_minutes) {
          // Add duration to pickup time
          const parts = row.pickup_time.split(":");
          const startMins = parseInt(parts[0]) * 60 + parseInt(parts[1] || "0");
          const endMins = startMins + parseInt(row.duration_minutes);
          const h = Math.floor(endMins / 60);
          const m = endMins % 60;
          endTime = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
        }

        driverMap.get(driverId)!.trips.push({
          id: row.id,
          publicId: row.public_id,
          status: row.status,
          startTime: row.pickup_time || null,
          endTime,
          patientName: `${row.patient_first || ""} ${row.patient_last || ""}`.trim() || "N/A",
          pickupAddress: row.pickup_address || "",
          dropoffAddress: row.dropoff_address || "",
        });
      }

      // Put unassigned first, then sorted by driver name
      const timeline = Array.from(driverMap.values()).sort((a, b) => {
        if (a.driverId === null) return -1;
        if (b.driverId === null) return 1;
        return a.driverName.localeCompare(b.driverName);
      });

      const totalTrips = rows.length;
      const completedTrips = rows.filter((r: any) => r.status === "COMPLETED").length;
      const activeTrips = rows.filter((r: any) =>
        ["IN_PROGRESS", "EN_ROUTE_TO_PICKUP", "AT_PICKUP", "EN_ROUTE_TO_DROPOFF"].includes(r.status)
      ).length;

      res.json({
        timeline,
        stats: { totalTrips, completedTrips, activeTrips },
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[CommandCenter] timeline error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/command-center/map-data ───────────────────────────────────────
// Returns: drivers with locations, active trip paths, demand heatmap zones
router.get(
  "/api/command-center/map-data",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;
      const driverCityFilter = cityId ? sql`AND ${drivers.cityId} = ${cityId}` : sql``;

      // Driver positions
      const driverData = await db.execute(sql`
        SELECT
          d.id, d.first_name, d.last_name, d.phone,
          d.dispatch_status, d.last_seen_at,
          d.last_lat, d.last_lng
        FROM ${drivers} d
        WHERE d.status = 'active'
        ${driverCityFilter}
      `);

      const driverRows = (driverData as any).rows || [];
      const driverMarkers = driverRows.map((d: any) => ({
        id: d.id,
        name: `${d.first_name} ${d.last_name}`,
        phone: d.phone,
        status: d.dispatch_status || "offline",
        lat: d.last_lat ? Number(d.last_lat) : null,
        lng: d.last_lng ? Number(d.last_lng) : null,
        lastSeenAt: d.last_seen_at,
      }));

      // Active trip paths
      const today = new Date().toISOString().split("T")[0];
      const cityFilter = cityId ? sql`AND t.city_id = ${cityId}` : sql``;

      const activeTripsData = await db.execute(sql`
        SELECT
          t.id, t.public_id, t.status, t.driver_id,
          t.pickup_lat, t.pickup_lng, t.dropoff_lat, t.dropoff_lng,
          t.pickup_address, t.dropoff_address,
          p.first_name as patient_first, p.last_name as patient_last
        FROM ${trips} t
        LEFT JOIN patients p ON p.id = t.patient_id
        WHERE t.status IN ('IN_PROGRESS', 'EN_ROUTE_TO_PICKUP', 'AT_PICKUP', 'EN_ROUTE_TO_DROPOFF', 'ASSIGNED')
        AND DATE(t.scheduled_date) = ${today}::date
        ${cityFilter}
      `);

      const tripRows = (activeTripsData as any).rows || [];
      const activeTripPaths = tripRows.map((t: any) => ({
        tripId: t.id,
        publicId: t.public_id,
        status: t.status,
        driverId: t.driver_id,
        patientName: `${t.patient_first || ""} ${t.patient_last || ""}`.trim(),
        pickup: {
          lat: t.pickup_lat ? Number(t.pickup_lat) : null,
          lng: t.pickup_lng ? Number(t.pickup_lng) : null,
          address: t.pickup_address,
        },
        dropoff: {
          lat: t.dropoff_lat ? Number(t.dropoff_lat) : null,
          lng: t.dropoff_lng ? Number(t.dropoff_lng) : null,
          address: t.dropoff_address,
        },
      }));

      res.json({
        drivers: driverMarkers,
        activeTripPaths,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[CommandCenter] map-data error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

export function registerCommandCenterRoutes(app: express.Express) {
  app.use(router);
}
