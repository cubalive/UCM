import { db } from "../db";
import { trips, drivers } from "@shared/schema";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import { setJson, getJson } from "./redis";
import { cache } from "./cache";

const CACHE_PREFIX = "demand_prediction";
const CACHE_TTL_SECONDS = 300; // 5 min

interface ZoneDemand {
  zone: string;
  lat: number;
  lng: number;
  predictedTrips: number;
  confidence: number;
  trend: "rising" | "stable" | "declining";
}

interface HeatmapPoint {
  lat: number;
  lng: number;
  intensity: number;
}

interface DriverPosition {
  zone: string;
  lat: number;
  lng: number;
  recommendedDrivers: number;
  reason: string;
}

// Grid zone size in degrees (~1 mile)
const ZONE_SIZE = 0.015;
// Exponential smoothing alpha — higher = more weight on recent weeks
const EWM_ALPHA = 0.3;
// Lookback weeks
const LOOKBACK_WEEKS = 12;

function zoneKey(lat: number, lng: number): string {
  const zLat = Math.floor(lat / ZONE_SIZE) * ZONE_SIZE;
  const zLng = Math.floor(lng / ZONE_SIZE) * ZONE_SIZE;
  return `${zLat.toFixed(3)},${zLng.toFixed(3)}`;
}

function zoneCenter(key: string): { lat: number; lng: number } {
  const [latStr, lngStr] = key.split(",");
  return {
    lat: parseFloat(latStr) + ZONE_SIZE / 2,
    lng: parseFloat(lngStr) + ZONE_SIZE / 2,
  };
}

/**
 * Exponential Weighted Moving Average (EWMA).
 * More recent data points receive higher weight, making the prediction
 * responsive to trend changes while smoothing out noise.
 *
 * weights[i] = alpha * (1 - alpha)^i  for i = 0 (most recent) .. n-1 (oldest)
 */
function exponentialWeightedAverage(weeklyValues: number[]): number {
  if (weeklyValues.length === 0) return 0;
  if (weeklyValues.length === 1) return weeklyValues[0];

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < weeklyValues.length; i++) {
    const weight = EWM_ALPHA * Math.pow(1 - EWM_ALPHA, i);
    numerator += weight * weeklyValues[i];
    denominator += weight;
  }

  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Detect trend direction from weekly values (most recent first).
 */
function detectTrend(weeklyValues: number[]): "rising" | "stable" | "declining" {
  if (weeklyValues.length < 3) return "stable";

  // Compare average of last 3 weeks vs previous 3 weeks
  const recent = weeklyValues.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
  const previous = weeklyValues.slice(3, 6).reduce((s, v) => s + v, 0) / Math.min(3, weeklyValues.slice(3, 6).length || 1);

  if (previous === 0) return recent > 0 ? "rising" : "stable";

  const changeRate = (recent - previous) / previous;
  if (changeRate > 0.15) return "rising";
  if (changeRate < -0.15) return "declining";
  return "stable";
}

/**
 * Predict demand by zone for a given company, city, date, and optional hour.
 * Uses Exponential Weighted Moving Average (EWMA) with day-of-week and hour
 * seasonality from the last 12 weeks of historical data.
 */
export async function predictDemand(
  companyId: number,
  cityId: number,
  date: string,
  hour?: number
): Promise<ZoneDemand[]> {
  const cacheKey = `${CACHE_PREFIX}:demand:${companyId}:${cityId}:${date}:${hour ?? "all"}`;

  // Try cache first
  try {
    const cached = await getJson<ZoneDemand[]>(cacheKey);
    if (cached) return cached;
  } catch {
    const memCached = cache.get<ZoneDemand[]>(cacheKey);
    if (memCached) return memCached;
  }

  const targetDate = new Date(date);

  // Look back N weeks for same day-of-week
  const historicalDates: string[] = [];
  for (let w = 1; w <= LOOKBACK_WEEKS; w++) {
    const d = new Date(targetDate);
    d.setDate(d.getDate() - w * 7);
    historicalDates.push(d.toISOString().slice(0, 10));
  }

  // Query historical trips for those dates
  const conditions: any[] = [
    eq(trips.companyId, companyId),
    eq(trips.cityId, cityId),
    sql`${trips.scheduledDate} = ANY(${historicalDates})`,
    sql`${trips.status} NOT IN ('CANCELLED', 'NO_SHOW')`,
  ];

  if (hour !== undefined) {
    const hourStr = hour.toString().padStart(2, "0");
    conditions.push(sql`${trips.pickupTime} >= ${hourStr + ":00"}`);
    conditions.push(sql`${trips.pickupTime} < ${(hour + 1).toString().padStart(2, "0") + ":00"}`);
  }

  const historicalTrips = await db
    .select({
      pickupLat: trips.pickupLat,
      pickupLng: trips.pickupLng,
      scheduledDate: trips.scheduledDate,
    })
    .from(trips)
    .where(and(...conditions));

  // Group by zone and by week (for EWMA)
  const zoneWeekMap = new Map<string, Map<string, number>>();

  for (const t of historicalTrips) {
    if (!t.pickupLat || !t.pickupLng) continue;
    const key = zoneKey(t.pickupLat, t.pickupLng);
    if (!zoneWeekMap.has(key)) {
      zoneWeekMap.set(key, new Map());
    }
    const weekMap = zoneWeekMap.get(key)!;
    const count = weekMap.get(t.scheduledDate) || 0;
    weekMap.set(t.scheduledDate, count + 1);
  }

  const result: ZoneDemand[] = [];

  for (const [key, weekMap] of zoneWeekMap) {
    const center = zoneCenter(key);

    // Build weekly values array ordered most-recent-first for EWMA
    const weeklyValues: number[] = [];
    for (const dateStr of historicalDates) {
      weeklyValues.push(weekMap.get(dateStr) || 0);
    }

    const predicted = exponentialWeightedAverage(weeklyValues);
    const trend = detectTrend(weeklyValues);

    // Confidence: combination of data coverage and consistency
    const weeksWithData = weeklyValues.filter(v => v > 0).length;
    const dataCoverage = weeksWithData / LOOKBACK_WEEKS;
    // Low variance = higher confidence
    const mean = weeklyValues.reduce((s, v) => s + v, 0) / weeklyValues.length;
    const variance = mean > 0
      ? weeklyValues.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / weeklyValues.length / (mean * mean)
      : 1;
    const consistencyScore = Math.max(0, 1 - Math.sqrt(variance));
    const confidence = Math.round((dataCoverage * 0.6 + consistencyScore * 0.4) * 100) / 100;

    result.push({
      zone: key,
      lat: center.lat,
      lng: center.lng,
      predictedTrips: Math.round(predicted * 10) / 10,
      confidence: Math.min(confidence, 1),
      trend,
    });
  }

  // Sort by predicted demand descending
  result.sort((a, b) => b.predictedTrips - a.predictedTrips);

  // Cache result
  try {
    await setJson(cacheKey, result, CACHE_TTL_SECONDS);
  } catch {
    cache.set(cacheKey, result, CACHE_TTL_SECONDS * 1000);
  }

  return result;
}

/**
 * Generate heatmap data for demand visualization.
 */
export async function getDemandHeatmap(
  companyId: number,
  cityId: number,
  date: string
): Promise<HeatmapPoint[]> {
  const cacheKey = `${CACHE_PREFIX}:heatmap:${companyId}:${cityId}:${date}`;

  try {
    const cached = await getJson<HeatmapPoint[]>(cacheKey);
    if (cached) return cached;
  } catch {
    const memCached = cache.get<HeatmapPoint[]>(cacheKey);
    if (memCached) return memCached;
  }

  // Get demand predictions for each hour of the day
  const allDemands: ZoneDemand[] = [];
  for (let h = 6; h <= 20; h++) {
    const hourDemand = await predictDemand(companyId, cityId, date, h);
    allDemands.push(...hourDemand);
  }

  // Aggregate by zone
  const zoneAgg = new Map<string, { lat: number; lng: number; totalDemand: number }>();
  for (const d of allDemands) {
    const existing = zoneAgg.get(d.zone);
    if (existing) {
      existing.totalDemand += d.predictedTrips;
    } else {
      zoneAgg.set(d.zone, { lat: d.lat, lng: d.lng, totalDemand: d.predictedTrips });
    }
  }

  // Normalize intensity to 0-1 range
  const maxDemand = Math.max(...Array.from(zoneAgg.values()).map(z => z.totalDemand), 1);

  const heatmap: HeatmapPoint[] = Array.from(zoneAgg.values()).map(z => ({
    lat: z.lat,
    lng: z.lng,
    intensity: Math.round((z.totalDemand / maxDemand) * 100) / 100,
  }));

  heatmap.sort((a, b) => b.intensity - a.intensity);

  try {
    await setJson(cacheKey, heatmap, CACHE_TTL_SECONDS);
  } catch {
    cache.set(cacheKey, heatmap, CACHE_TTL_SECONDS * 1000);
  }

  return heatmap;
}

/**
 * Suggest optimal positioning for idle drivers based on predicted demand.
 * Accounts for trend direction — zones with rising demand get priority.
 */
export async function getOptimalDriverPositioning(
  companyId: number,
  cityId: number,
  date: string,
  hour: number
): Promise<DriverPosition[]> {
  const cacheKey = `${CACHE_PREFIX}:positioning:${companyId}:${cityId}:${date}:${hour}`;

  try {
    const cached = await getJson<DriverPosition[]>(cacheKey);
    if (cached) return cached;
  } catch {
    const memCached = cache.get<DriverPosition[]>(cacheKey);
    if (memCached) return memCached;
  }

  // Get demand predictions for this hour
  const demand = await predictDemand(companyId, cityId, date, hour);

  // Get available driver count
  const availableDrivers = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(
      and(
        eq(drivers.companyId, companyId),
        eq(drivers.cityId, cityId),
        eq(drivers.status, "ACTIVE"),
        sql`${drivers.dispatchStatus} IN ('available', 'off')`,
        sql`${drivers.deletedAt} IS NULL`
      )
    );

  const totalDrivers = availableDrivers.length;
  if (totalDrivers === 0 || demand.length === 0) {
    return [];
  }

  // Weight demand by trend: rising zones get a 20% boost, declining get 20% reduction
  const trendMultiplier = (trend: string) => {
    switch (trend) {
      case "rising": return 1.2;
      case "declining": return 0.8;
      default: return 1.0;
    }
  };

  const weightedDemand = demand.map(d => ({
    ...d,
    weightedTrips: d.predictedTrips * trendMultiplier(d.trend),
  }));

  const totalWeightedDemand = weightedDemand.reduce((s, d) => s + d.weightedTrips, 0);
  if (totalWeightedDemand === 0) return [];

  const positions: DriverPosition[] = [];
  let driversAssigned = 0;

  for (const zone of weightedDemand) {
    if (driversAssigned >= totalDrivers) break;

    const proportion = zone.weightedTrips / totalWeightedDemand;
    const recommended = Math.max(1, Math.round(proportion * totalDrivers));
    const actual = Math.min(recommended, totalDrivers - driversAssigned);

    const trendLabel = zone.trend === "rising" ? " (trending up)" : zone.trend === "declining" ? " (trending down)" : "";

    positions.push({
      zone: zone.zone,
      lat: zone.lat,
      lng: zone.lng,
      recommendedDrivers: actual,
      reason: `${zone.predictedTrips} predicted trips (${Math.round(proportion * 100)}% of demand)${trendLabel}`,
    });

    driversAssigned += actual;
  }

  try {
    await setJson(cacheKey, positions, CACHE_TTL_SECONDS);
  } catch {
    cache.set(cacheKey, positions, CACHE_TTL_SECONDS * 1000);
  }

  return positions;
}
