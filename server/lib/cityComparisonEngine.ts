import { db } from "../db";
import {
  dailyMetricsRollup,
  trips,
  drivers,
  cities,
  companyCities,
} from "@shared/schema";
import { eq, and, sql, desc, inArray, gte, lte } from "drizzle-orm";

interface DateRange {
  from: string;
  to: string;
}

interface CityMetrics {
  cityId: number;
  cityName: string;
  cityState: string;
  tripsTotal: number;
  tripsCompleted: number;
  tripsCancelled: number;
  tripsNoShow: number;
  completionRate: number;
  noShowRate: number;
  cancellationRate: number;
  onTimePickupCount: number;
  latePickupCount: number;
  onTimeRate: number;
  avgPickupDelayMinutes: number;
  revenueCents: number;
  revenuePerTrip: number;
  estCostCents: number;
  costPerMile: number;
  marginCents: number;
  emptyMiles: number;
  paidMiles: number;
  deadMileRatio: number;
  activeMinutes: number;
  idleMinutes: number;
  driverUtilization: number;
}

/**
 * Compare key metrics across multiple cities over a date range.
 */
export async function compareCities(
  cityIds: number[],
  dateRange: DateRange
): Promise<CityMetrics[]> {
  if (cityIds.length === 0) return [];

  const rows = await db.execute(sql`
    SELECT
      dmr.city_id,
      c.name AS city_name,
      c.state AS city_state,
      COALESCE(SUM(dmr.trips_total), 0)::int AS trips_total,
      COALESCE(SUM(dmr.trips_completed), 0)::int AS trips_completed,
      COALESCE(SUM(dmr.trips_cancelled), 0)::int AS trips_cancelled,
      COALESCE(SUM(dmr.trips_no_show), 0)::int AS trips_no_show,
      COALESCE(SUM(dmr.on_time_pickup_count), 0)::int AS on_time_pickup_count,
      COALESCE(SUM(dmr.late_pickup_count), 0)::int AS late_pickup_count,
      COALESCE(AVG(dmr.avg_pickup_delay_minutes::numeric), 0) AS avg_pickup_delay_minutes,
      COALESCE(SUM(dmr.revenue_cents), 0)::int AS revenue_cents,
      COALESCE(SUM(dmr.est_cost_cents), 0)::int AS est_cost_cents,
      COALESCE(SUM(dmr.margin_cents), 0)::int AS margin_cents,
      COALESCE(SUM(dmr.empty_miles::numeric), 0) AS empty_miles,
      COALESCE(SUM(dmr.paid_miles::numeric), 0) AS paid_miles,
      COALESCE(SUM(dmr.active_minutes::numeric), 0) AS active_minutes,
      COALESCE(SUM(dmr.idle_minutes::numeric), 0) AS idle_minutes
    FROM ${dailyMetricsRollup} dmr
    JOIN ${cities} c ON c.id = dmr.city_id
    WHERE dmr.city_id = ANY(${cityIds})
      AND dmr.metric_date >= ${dateRange.from}
      AND dmr.metric_date <= ${dateRange.to}
      AND dmr.clinic_id IS NULL
      AND dmr.driver_id IS NULL
    GROUP BY dmr.city_id, c.name, c.state
    ORDER BY trips_total DESC
  `);

  const results = ((rows as any).rows || []).map((r: any) => {
    const tripsTotal = Number(r.trips_total);
    const tripsCompleted = Number(r.trips_completed);
    const tripsCancelled = Number(r.trips_cancelled);
    const tripsNoShow = Number(r.trips_no_show);
    const onTimeCount = Number(r.on_time_pickup_count);
    const lateCount = Number(r.late_pickup_count);
    const totalPickups = onTimeCount + lateCount;
    const emptyMiles = Number(r.empty_miles);
    const paidMiles = Number(r.paid_miles);
    const totalMiles = emptyMiles + paidMiles;
    const activeMinutes = Number(r.active_minutes);
    const idleMinutes = Number(r.idle_minutes);
    const totalMinutes = activeMinutes + idleMinutes;
    const revenueCents = Number(r.revenue_cents);
    const estCostCents = Number(r.est_cost_cents);

    return {
      cityId: Number(r.city_id),
      cityName: r.city_name,
      cityState: r.city_state,
      tripsTotal,
      tripsCompleted,
      tripsCancelled,
      tripsNoShow,
      completionRate: tripsTotal > 0 ? Math.round((tripsCompleted / tripsTotal) * 10000) / 100 : 0,
      noShowRate: tripsTotal > 0 ? Math.round((tripsNoShow / tripsTotal) * 10000) / 100 : 0,
      cancellationRate: tripsTotal > 0 ? Math.round((tripsCancelled / tripsTotal) * 10000) / 100 : 0,
      onTimePickupCount: onTimeCount,
      latePickupCount: lateCount,
      onTimeRate: totalPickups > 0 ? Math.round((onTimeCount / totalPickups) * 10000) / 100 : 0,
      avgPickupDelayMinutes: Math.round(Number(r.avg_pickup_delay_minutes) * 100) / 100,
      revenueCents,
      revenuePerTrip: tripsCompleted > 0 ? Math.round(revenueCents / tripsCompleted) : 0,
      estCostCents,
      costPerMile: paidMiles > 0 ? Math.round((estCostCents / paidMiles) * 100) / 100 : 0,
      marginCents: Number(r.margin_cents),
      emptyMiles: Math.round(emptyMiles * 100) / 100,
      paidMiles: Math.round(paidMiles * 100) / 100,
      deadMileRatio: totalMiles > 0 ? Math.round((emptyMiles / totalMiles) * 10000) / 100 : 0,
      activeMinutes: Math.round(activeMinutes),
      idleMinutes: Math.round(idleMinutes),
      driverUtilization: totalMinutes > 0 ? Math.round((activeMinutes / totalMinutes) * 10000) / 100 : 0,
    };
  });

  return results;
}

/**
 * Rank cities by a specific metric over a date range.
 */
export async function getCityRankings(
  companyId: number,
  metricKey: string,
  dateRange: DateRange
): Promise<{ rank: number; cityId: number; cityName: string; value: number }[]> {
  // Get all cities for this company
  const companyCityRows = await db
    .select({ cityId: companyCities.cityId })
    .from(companyCities)
    .where(and(eq(companyCities.companyId, companyId), eq(companyCities.isActive, true)));

  const cityIds = companyCityRows.map((c) => c.cityId);
  if (cityIds.length === 0) return [];

  const metrics = await compareCities(cityIds, dateRange);

  // Map metricKey to field
  const validKeys: Record<string, keyof CityMetrics> = {
    trips_total: "tripsTotal",
    completion_rate: "completionRate",
    no_show_rate: "noShowRate",
    on_time_rate: "onTimeRate",
    avg_pickup_delay: "avgPickupDelayMinutes",
    revenue_per_trip: "revenuePerTrip",
    cost_per_mile: "costPerMile",
    dead_mile_ratio: "deadMileRatio",
    driver_utilization: "driverUtilization",
    margin: "marginCents",
  };

  const field = validKeys[metricKey];
  if (!field) {
    throw new Error(
      `Invalid metric key '${metricKey}'. Valid keys: ${Object.keys(validKeys).join(", ")}`
    );
  }

  // Determine sort direction (lower is better for some metrics)
  const lowerIsBetter = ["noShowRate", "avgPickupDelayMinutes", "costPerMile", "deadMileRatio"];
  const ascending = lowerIsBetter.includes(field as string);

  const sorted = [...metrics].sort((a, b) => {
    const aVal = Number(a[field]);
    const bVal = Number(b[field]);
    return ascending ? aVal - bVal : bVal - aVal;
  });

  return sorted.map((m, i) => ({
    rank: i + 1,
    cityId: m.cityId,
    cityName: `${m.cityName}, ${m.cityState}`,
    value: Number(m[field]),
  }));
}

/**
 * Get trend data for a city over time (daily granularity).
 */
export async function getCityTrends(
  cityId: number,
  dateRange: DateRange
): Promise<{
  cityId: number;
  cityName: string;
  trends: Array<{
    date: string;
    tripsTotal: number;
    tripsCompleted: number;
    tripsCancelled: number;
    tripsNoShow: number;
    completionRate: number;
    onTimeRate: number;
    revenueCents: number;
    emptyMiles: number;
    paidMiles: number;
  }>;
}> {
  const [city] = await db
    .select({ id: cities.id, name: cities.name, state: cities.state })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1);

  if (!city) {
    throw new Error("City not found");
  }

  const rows = await db.execute(sql`
    SELECT
      dmr.metric_date,
      COALESCE(SUM(dmr.trips_total), 0)::int AS trips_total,
      COALESCE(SUM(dmr.trips_completed), 0)::int AS trips_completed,
      COALESCE(SUM(dmr.trips_cancelled), 0)::int AS trips_cancelled,
      COALESCE(SUM(dmr.trips_no_show), 0)::int AS trips_no_show,
      COALESCE(SUM(dmr.on_time_pickup_count), 0)::int AS on_time_pickup_count,
      COALESCE(SUM(dmr.late_pickup_count), 0)::int AS late_pickup_count,
      COALESCE(SUM(dmr.revenue_cents), 0)::int AS revenue_cents,
      COALESCE(SUM(dmr.empty_miles::numeric), 0) AS empty_miles,
      COALESCE(SUM(dmr.paid_miles::numeric), 0) AS paid_miles
    FROM ${dailyMetricsRollup} dmr
    WHERE dmr.city_id = ${cityId}
      AND dmr.metric_date >= ${dateRange.from}
      AND dmr.metric_date <= ${dateRange.to}
      AND dmr.clinic_id IS NULL
      AND dmr.driver_id IS NULL
    GROUP BY dmr.metric_date
    ORDER BY dmr.metric_date ASC
  `);

  const trends = ((rows as any).rows || []).map((r: any) => {
    const total = Number(r.trips_total);
    const completed = Number(r.trips_completed);
    const onTime = Number(r.on_time_pickup_count);
    const late = Number(r.late_pickup_count);
    const totalPickups = onTime + late;

    return {
      date: r.metric_date,
      tripsTotal: total,
      tripsCompleted: completed,
      tripsCancelled: Number(r.trips_cancelled),
      tripsNoShow: Number(r.trips_no_show),
      completionRate: total > 0 ? Math.round((completed / total) * 10000) / 100 : 0,
      onTimeRate: totalPickups > 0 ? Math.round((onTime / totalPickups) * 10000) / 100 : 0,
      revenueCents: Number(r.revenue_cents),
      emptyMiles: Math.round(Number(r.empty_miles) * 100) / 100,
      paidMiles: Math.round(Number(r.paid_miles) * 100) / 100,
    };
  });

  return {
    cityId,
    cityName: `${city.name}, ${city.state}`,
    trends,
  };
}

/**
 * Calculate company-wide benchmarks (averages across all cities).
 */
export async function getBenchmarks(
  companyId: number
): Promise<{
  period: { from: string; to: string };
  cityCount: number;
  benchmarks: {
    avgCompletionRate: number;
    avgNoShowRate: number;
    avgOnTimeRate: number;
    avgPickupDelayMinutes: number;
    avgRevenuePerTrip: number;
    avgDeadMileRatio: number;
    avgDriverUtilization: number;
    totalTrips: number;
    totalRevenueCents: number;
  };
}> {
  // Default to last 30 days
  const to = new Date().toISOString().split("T")[0];
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  const from = fromDate.toISOString().split("T")[0];

  const companyCityRows = await db
    .select({ cityId: companyCities.cityId })
    .from(companyCities)
    .where(and(eq(companyCities.companyId, companyId), eq(companyCities.isActive, true)));

  const cityIds = companyCityRows.map((c) => c.cityId);
  if (cityIds.length === 0) {
    return {
      period: { from, to },
      cityCount: 0,
      benchmarks: {
        avgCompletionRate: 0,
        avgNoShowRate: 0,
        avgOnTimeRate: 0,
        avgPickupDelayMinutes: 0,
        avgRevenuePerTrip: 0,
        avgDeadMileRatio: 0,
        avgDriverUtilization: 0,
        totalTrips: 0,
        totalRevenueCents: 0,
      },
    };
  }

  const metrics = await compareCities(cityIds, { from, to });

  if (metrics.length === 0) {
    return {
      period: { from, to },
      cityCount: cityIds.length,
      benchmarks: {
        avgCompletionRate: 0,
        avgNoShowRate: 0,
        avgOnTimeRate: 0,
        avgPickupDelayMinutes: 0,
        avgRevenuePerTrip: 0,
        avgDeadMileRatio: 0,
        avgDriverUtilization: 0,
        totalTrips: 0,
        totalRevenueCents: 0,
      },
    };
  }

  const n = metrics.length;
  const sum = (fn: (m: CityMetrics) => number) =>
    metrics.reduce((acc, m) => acc + fn(m), 0);

  return {
    period: { from, to },
    cityCount: n,
    benchmarks: {
      avgCompletionRate: Math.round((sum((m) => m.completionRate) / n) * 100) / 100,
      avgNoShowRate: Math.round((sum((m) => m.noShowRate) / n) * 100) / 100,
      avgOnTimeRate: Math.round((sum((m) => m.onTimeRate) / n) * 100) / 100,
      avgPickupDelayMinutes: Math.round((sum((m) => m.avgPickupDelayMinutes) / n) * 100) / 100,
      avgRevenuePerTrip: Math.round(sum((m) => m.revenuePerTrip) / n),
      avgDeadMileRatio: Math.round((sum((m) => m.deadMileRatio) / n) * 100) / 100,
      avgDriverUtilization: Math.round((sum((m) => m.driverUtilization) / n) * 100) / 100,
      totalTrips: sum((m) => m.tripsTotal),
      totalRevenueCents: sum((m) => m.revenueCents),
    },
  };
}

/**
 * Generate a full comparative report for selected cities.
 */
export async function generateComparativeReport(
  cityIds: number[],
  dateRange: DateRange
): Promise<{
  dateRange: DateRange;
  cities: CityMetrics[];
  bestPerformers: Record<string, { cityId: number; cityName: string; value: number }>;
  summary: string;
}> {
  const metrics = await compareCities(cityIds, dateRange);

  const findBest = (
    field: keyof CityMetrics,
    lowerIsBetter = false
  ): { cityId: number; cityName: string; value: number } => {
    if (metrics.length === 0)
      return { cityId: 0, cityName: "N/A", value: 0 };
    const sorted = [...metrics].sort((a, b) => {
      const aVal = Number(a[field]);
      const bVal = Number(b[field]);
      return lowerIsBetter ? aVal - bVal : bVal - aVal;
    });
    const best = sorted[0];
    return {
      cityId: best.cityId,
      cityName: `${best.cityName}, ${best.cityState}`,
      value: Number(best[field]),
    };
  };

  const bestPerformers = {
    highestVolume: findBest("tripsTotal"),
    bestCompletionRate: findBest("completionRate"),
    lowestNoShowRate: findBest("noShowRate", true),
    bestOnTimeRate: findBest("onTimeRate"),
    lowestPickupDelay: findBest("avgPickupDelayMinutes", true),
    highestRevenuePerTrip: findBest("revenuePerTrip"),
    lowestDeadMileRatio: findBest("deadMileRatio", true),
    bestDriverUtilization: findBest("driverUtilization"),
  };

  const totalTrips = metrics.reduce((s, m) => s + m.tripsTotal, 0);
  const avgCompletion =
    metrics.length > 0
      ? Math.round(
          (metrics.reduce((s, m) => s + m.completionRate, 0) / metrics.length) * 100
        ) / 100
      : 0;

  const summary = `Compared ${metrics.length} cities from ${dateRange.from} to ${dateRange.to}. ` +
    `Total trips: ${totalTrips}. Average completion rate: ${avgCompletion}%. ` +
    `Best completion: ${bestPerformers.bestCompletionRate.cityName} (${bestPerformers.bestCompletionRate.value}%). ` +
    `Highest volume: ${bestPerformers.highestVolume.cityName} (${bestPerformers.highestVolume.value} trips).`;

  return {
    dateRange,
    cities: metrics,
    bestPerformers,
    summary,
  };
}
