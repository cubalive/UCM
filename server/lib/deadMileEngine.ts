import { db } from "../db";
import { trips, drivers, deadMileSegments, deadMileDailySummary } from "@shared/schema";
import { eq, and, sql, inArray, isNull, desc } from "drizzle-orm";

/**
 * Haversine distance in meters between two lat/lng points.
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Meters to miles conversion */
function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

/** Estimate travel duration in seconds based on distance (avg 30mph for NEMT) */
function estimateDurationSeconds(distanceMeters: number): number {
  const avgSpeedMps = 13.41; // ~30 mph
  return Math.round(distanceMeters / avgSpeedMps);
}

interface CompletedTrip {
  id: number;
  driverId: number | null;
  companyId: number;
  cityId: number;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  pickupTime: string | null;
  scheduledDate: string;
  distanceMiles: number | null;
  routeDistanceMeters: number | null;
  actualDistanceMeters: number | null;
}

/**
 * Get completed trips for a driver on a given date, ordered by pickup time.
 */
async function getDriverTripsForDate(driverId: number, date: string): Promise<CompletedTrip[]> {
  const rows = await db
    .select({
      id: trips.id,
      driverId: trips.driverId,
      companyId: trips.companyId,
      cityId: trips.cityId,
      pickupLat: trips.pickupLat,
      pickupLng: trips.pickupLng,
      dropoffLat: trips.dropoffLat,
      dropoffLng: trips.dropoffLng,
      pickupTime: trips.pickupTime,
      scheduledDate: trips.scheduledDate,
      distanceMiles: trips.distanceMiles,
      routeDistanceMeters: trips.routeDistanceMeters,
      actualDistanceMeters: trips.actualDistanceMeters,
    })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.scheduledDate, date),
        eq(trips.status, "COMPLETED"),
        isNull(trips.deletedAt),
      )
    )
    .orderBy(trips.pickupTime);

  return rows as CompletedTrip[];
}

/**
 * Calculate dead-mile segments for a single driver on a given date.
 * Dead miles = miles driven without a passenger.
 */
export async function calculateDeadMilesForDriver(driverId: number, date: string): Promise<number> {
  const driverTrips = await getDriverTripsForDate(driverId, date);
  if (driverTrips.length === 0) return 0;

  // Get driver info for base location and company/city
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
  if (!driver) return 0;

  const companyId = driver.companyId;
  const cityId = driver.cityId;

  // Delete existing segments for this driver/date before recalculating
  await db.delete(deadMileSegments).where(
    and(
      eq(deadMileSegments.driverId, driverId),
      eq(deadMileSegments.segmentDate, date),
    )
  );

  const segments: Array<{
    driverId: number;
    companyId: number;
    cityId: number;
    segmentDate: string;
    segmentType: string;
    fromTripId: number | null;
    toTripId: number | null;
    fromLat: number;
    fromLng: number;
    toLat: number;
    toLng: number;
    distanceMeters: number;
    durationSeconds: number;
  }> = [];

  // 1. To first pickup: from driver's last known location (or first trip's pickup as proxy)
  const firstTrip = driverTrips[0];
  if (firstTrip.pickupLat && firstTrip.pickupLng) {
    const baseLat = driver.lastLat ?? firstTrip.pickupLat;
    const baseLng = driver.lastLng ?? firstTrip.pickupLng;

    // Only add if driver has a known base location different from pickup
    if (driver.lastLat != null && driver.lastLng != null) {
      const dist = haversineDistance(baseLat, baseLng, firstTrip.pickupLat, firstTrip.pickupLng);
      if (dist > 100) { // more than 100m
        segments.push({
          driverId,
          companyId,
          cityId,
          segmentDate: date,
          segmentType: "to_first_pickup",
          fromTripId: null,
          toTripId: firstTrip.id,
          fromLat: baseLat,
          fromLng: baseLng,
          toLat: firstTrip.pickupLat,
          toLng: firstTrip.pickupLng,
          distanceMeters: Math.round(dist),
          durationSeconds: estimateDurationSeconds(dist),
        });
      }
    }
  }

  // 2. Between trips: from dropoff of trip N to pickup of trip N+1
  for (let i = 0; i < driverTrips.length - 1; i++) {
    const current = driverTrips[i];
    const next = driverTrips[i + 1];

    if (current.dropoffLat && current.dropoffLng && next.pickupLat && next.pickupLng) {
      const dist = haversineDistance(
        current.dropoffLat, current.dropoffLng,
        next.pickupLat, next.pickupLng,
      );
      if (dist > 100) { // more than 100m
        segments.push({
          driverId,
          companyId,
          cityId,
          segmentDate: date,
          segmentType: "between_trips",
          fromTripId: current.id,
          toTripId: next.id,
          fromLat: current.dropoffLat,
          fromLng: current.dropoffLng,
          toLat: next.pickupLat,
          toLng: next.pickupLng,
          distanceMeters: Math.round(dist),
          durationSeconds: estimateDurationSeconds(dist),
        });
      }
    }
  }

  // 3. Return to base: from last dropoff back to driver's base location
  const lastTrip = driverTrips[driverTrips.length - 1];
  if (lastTrip.dropoffLat && lastTrip.dropoffLng && driver.lastLat != null && driver.lastLng != null) {
    const dist = haversineDistance(
      lastTrip.dropoffLat, lastTrip.dropoffLng,
      driver.lastLat, driver.lastLng,
    );
    if (dist > 100) {
      segments.push({
        driverId,
        companyId,
        cityId,
        segmentDate: date,
        segmentType: "return_to_base",
        fromTripId: lastTrip.id,
        toTripId: null,
        fromLat: lastTrip.dropoffLat,
        fromLng: lastTrip.dropoffLng,
        toLat: driver.lastLat,
        toLng: driver.lastLng,
        distanceMeters: Math.round(dist),
        durationSeconds: estimateDurationSeconds(dist),
      });
    }
  }

  // Insert all segments
  if (segments.length > 0) {
    await db.insert(deadMileSegments).values(segments);
  }

  console.log(`[DEAD-MILE] Driver ${driverId} date ${date}: ${segments.length} segments calculated`);
  return segments.length;
}

/**
 * Calculate and store the daily summary for a driver.
 */
export async function calculateDailySummary(driverId: number, date: string): Promise<void> {
  const driverTrips = await getDriverTripsForDate(driverId, date);

  const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId));
  if (!driver) return;

  // Sum paid miles from completed trips
  let totalPaidMeters = 0;
  for (const trip of driverTrips) {
    const meters = trip.actualDistanceMeters ?? trip.routeDistanceMeters ?? (trip.distanceMiles ? trip.distanceMiles * 1609.344 : 0);
    totalPaidMeters += meters;
  }

  // Sum dead miles from segments
  const segmentRows = await db
    .select({ distanceMeters: deadMileSegments.distanceMeters, durationSeconds: deadMileSegments.durationSeconds })
    .from(deadMileSegments)
    .where(
      and(
        eq(deadMileSegments.driverId, driverId),
        eq(deadMileSegments.segmentDate, date),
      )
    );

  let totalDeadMeters = 0;
  let totalDeadDurationSeconds = 0;
  for (const seg of segmentRows) {
    totalDeadMeters += seg.distanceMeters;
    totalDeadDurationSeconds += seg.durationSeconds;
  }

  const totalPaidMiles = metersToMiles(totalPaidMeters);
  const totalDeadMiles = metersToMiles(totalDeadMeters);
  const totalMiles = totalPaidMiles + totalDeadMiles;
  const deadMileRatio = totalMiles > 0 ? totalDeadMiles / totalMiles : 0;

  // Estimate total driving duration (paid + dead)
  const avgSpeedMps = 13.41; // ~30 mph
  const paidDurationSeconds = totalPaidMeters / avgSpeedMps;
  const totalDurationMinutes = Math.round((paidDurationSeconds + totalDeadDurationSeconds) / 60);

  // Idle minutes = rough estimate of gaps not accounted for by driving
  const idleMinutes = Math.max(0, totalDurationMinutes - Math.round((paidDurationSeconds + totalDeadDurationSeconds) / 60));

  // Efficiency score: 100 = no dead miles, 0 = all dead miles
  const efficiencyScore = totalMiles > 0
    ? Math.round((1 - deadMileRatio) * 100)
    : (driverTrips.length > 0 ? 100 : 0);

  // Upsert the daily summary
  await db.delete(deadMileDailySummary).where(
    and(
      eq(deadMileDailySummary.driverId, driverId),
      eq(deadMileDailySummary.summaryDate, date),
    )
  );

  await db.insert(deadMileDailySummary).values({
    driverId,
    companyId: driver.companyId,
    cityId: driver.cityId,
    summaryDate: date,
    totalTrips: driverTrips.length,
    totalPaidMiles: totalPaidMiles.toFixed(2),
    totalDeadMiles: totalDeadMiles.toFixed(2),
    deadMileRatio: deadMileRatio.toFixed(4),
    totalDurationMinutes,
    idleMinutes,
    efficiencyScore,
  });

  console.log(`[DEAD-MILE] Driver ${driverId} date ${date}: summary saved (ratio=${deadMileRatio.toFixed(3)}, score=${efficiencyScore})`);
}

/**
 * Batch calculate dead miles for all active drivers in a company on a given date.
 */
export async function batchCalculateDeadMiles(companyId: number, date: string): Promise<{ driversProcessed: number; totalSegments: number }> {
  const companyDrivers = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(
      and(
        eq(drivers.companyId, companyId),
        eq(drivers.status, "ACTIVE"),
        isNull(drivers.deletedAt),
      )
    );

  let totalSegments = 0;
  for (const driver of companyDrivers) {
    const segs = await calculateDeadMilesForDriver(driver.id, date);
    totalSegments += segs;
    await calculateDailySummary(driver.id, date);
  }

  console.log(`[DEAD-MILE] Company ${companyId} date ${date}: ${companyDrivers.length} drivers, ${totalSegments} segments`);
  return { driversProcessed: companyDrivers.length, totalSegments };
}

/**
 * Generate dead-mile report for a company over a date range.
 */
export async function getDeadMileReport(companyId: number, fromDate: string, toDate: string) {
  const summaries = await db
    .select()
    .from(deadMileDailySummary)
    .where(
      and(
        eq(deadMileDailySummary.companyId, companyId),
        sql`${deadMileDailySummary.summaryDate} >= ${fromDate}`,
        sql`${deadMileDailySummary.summaryDate} <= ${toDate}`,
      )
    )
    .orderBy(deadMileDailySummary.summaryDate);

  // Aggregate per driver
  const byDriver = new Map<number, {
    driverId: number;
    totalTrips: number;
    totalPaidMiles: number;
    totalDeadMiles: number;
    avgEfficiency: number;
    days: number;
  }>();

  for (const s of summaries) {
    const existing = byDriver.get(s.driverId) || {
      driverId: s.driverId,
      totalTrips: 0,
      totalPaidMiles: 0,
      totalDeadMiles: 0,
      avgEfficiency: 0,
      days: 0,
    };
    existing.totalTrips += s.totalTrips;
    existing.totalPaidMiles += Number(s.totalPaidMiles);
    existing.totalDeadMiles += Number(s.totalDeadMiles);
    existing.avgEfficiency += s.efficiencyScore;
    existing.days += 1;
    byDriver.set(s.driverId, existing);
  }

  const driverReports = Array.from(byDriver.values()).map(d => ({
    ...d,
    avgEfficiency: d.days > 0 ? Math.round(d.avgEfficiency / d.days) : 0,
    deadMileRatio: (d.totalPaidMiles + d.totalDeadMiles) > 0
      ? Number((d.totalDeadMiles / (d.totalPaidMiles + d.totalDeadMiles)).toFixed(4))
      : 0,
  }));

  // Fleet totals
  const fleetTotalPaid = driverReports.reduce((a, d) => a + d.totalPaidMiles, 0);
  const fleetTotalDead = driverReports.reduce((a, d) => a + d.totalDeadMiles, 0);
  const fleetTotal = fleetTotalPaid + fleetTotalDead;

  return {
    companyId,
    fromDate,
    toDate,
    driverReports,
    fleet: {
      totalPaidMiles: Number(fleetTotalPaid.toFixed(2)),
      totalDeadMiles: Number(fleetTotalDead.toFixed(2)),
      deadMileRatio: fleetTotal > 0 ? Number((fleetTotalDead / fleetTotal).toFixed(4)) : 0,
      avgEfficiency: driverReports.length > 0
        ? Math.round(driverReports.reduce((a, d) => a + d.avgEfficiency, 0) / driverReports.length)
        : 0,
      totalDrivers: driverReports.length,
    },
  };
}

/**
 * Get fleet-wide efficiency metrics for a company over a date range.
 */
export async function getFleetEfficiency(companyId: number, fromDate: string, toDate: string) {
  // Daily fleet efficiency trend
  const dailyRows = await db.execute(sql`
    SELECT
      summary_date,
      COUNT(DISTINCT driver_id) as active_drivers,
      SUM(total_trips) as total_trips,
      SUM(total_paid_miles::numeric) as total_paid_miles,
      SUM(total_dead_miles::numeric) as total_dead_miles,
      AVG(efficiency_score) as avg_efficiency,
      AVG(dead_mile_ratio::numeric) as avg_dead_mile_ratio
    FROM ${deadMileDailySummary}
    WHERE company_id = ${companyId}
    AND summary_date >= ${fromDate}
    AND summary_date <= ${toDate}
    GROUP BY summary_date
    ORDER BY summary_date ASC
  `);

  const rows = (dailyRows as any).rows || [];
  const dailyTrend = rows.map((r: any) => ({
    date: r.summary_date,
    activeDrivers: Number(r.active_drivers),
    totalTrips: Number(r.total_trips),
    totalPaidMiles: Number(Number(r.total_paid_miles).toFixed(2)),
    totalDeadMiles: Number(Number(r.total_dead_miles).toFixed(2)),
    avgEfficiency: Math.round(Number(r.avg_efficiency)),
    avgDeadMileRatio: Number(Number(r.avg_dead_mile_ratio).toFixed(4)),
  }));

  // Overall stats
  const totalPaid = dailyTrend.reduce((a: number, d: any) => a + d.totalPaidMiles, 0);
  const totalDead = dailyTrend.reduce((a: number, d: any) => a + d.totalDeadMiles, 0);
  const totalAll = totalPaid + totalDead;

  return {
    companyId,
    fromDate,
    toDate,
    dailyTrend,
    overall: {
      totalPaidMiles: Number(totalPaid.toFixed(2)),
      totalDeadMiles: Number(totalDead.toFixed(2)),
      deadMileRatio: totalAll > 0 ? Number((totalDead / totalAll).toFixed(4)) : 0,
      avgEfficiency: dailyTrend.length > 0
        ? Math.round(dailyTrend.reduce((a: number, d: any) => a + d.avgEfficiency, 0) / dailyTrend.length)
        : 0,
      daysAnalyzed: dailyTrend.length,
    },
  };
}
