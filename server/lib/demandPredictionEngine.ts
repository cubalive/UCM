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
 * Predict demand by zone for a given company, city, date, and optional hour.
 * Uses simple moving averages with day-of-week weighting from the last 8 weeks of data.
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
  const dayOfWeek = targetDate.getDay(); // 0=Sun, 6=Sat

  // Look back 8 weeks for same day-of-week
  const historicalDates: string[] = [];
  for (let w = 1; w <= 8; w++) {
    const d = new Date(targetDate);
    d.setDate(d.getDate() - w * 7);
    historicalDates.push(d.toISOString().slice(0, 10));
  }

  // Query historical trips for those dates
  const conditions: any[] = [
    eq(trips.companyId, companyId),
    eq(trips.cityId, cityId),
    sql`${trips.scheduledDate} = ANY(${historicalDates})`,
    sql`${trips.status} != 'CANCELLED'`,
  ];

  if (hour !== undefined) {
    // Filter trips by hour using pickupTime (HH:MM format)
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

  // Group by zone
  const zoneMap = new Map<string, { dates: Set<string>; count: number }>();

  for (const t of historicalTrips) {
    if (!t.pickupLat || !t.pickupLng) continue;
    const key = zoneKey(t.pickupLat, t.pickupLng);
    if (!zoneMap.has(key)) {
      zoneMap.set(key, { dates: new Set(), count: 0 });
    }
    const zone = zoneMap.get(key)!;
    zone.dates.add(t.scheduledDate);
    zone.count++;
  }

  // Calculate moving average per zone
  const numWeeks = Math.max(historicalDates.length, 1);
  const result: ZoneDemand[] = [];

  for (const [key, data] of zoneMap) {
    const center = zoneCenter(key);
    const avgTrips = data.count / numWeeks;
    // Confidence based on how many weeks had data
    const weeksWithData = data.dates.size;
    const confidence = Math.min(weeksWithData / numWeeks, 1);

    result.push({
      zone: key,
      lat: center.lat,
      lng: center.lng,
      predictedTrips: Math.round(avgTrips * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
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

  // Distribute drivers proportionally to demand
  const totalDemand = demand.reduce((s, d) => s + d.predictedTrips, 0);
  if (totalDemand === 0) return [];

  const positions: DriverPosition[] = [];
  let driversAssigned = 0;

  for (const zone of demand) {
    if (driversAssigned >= totalDrivers) break;

    const proportion = zone.predictedTrips / totalDemand;
    const recommended = Math.max(1, Math.round(proportion * totalDrivers));
    const actual = Math.min(recommended, totalDrivers - driversAssigned);

    positions.push({
      zone: zone.zone,
      lat: zone.lat,
      lng: zone.lng,
      recommendedDrivers: actual,
      reason: `${zone.predictedTrips} predicted trips (${Math.round(proportion * 100)}% of demand)`,
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
