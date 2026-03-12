/**
 * Dispatch Hotspot Engine
 *
 * Analyzes historical trip origins to find demand clusters (hotspots),
 * bucketed by time of day. Recommends driver pre-positioning based
 * on predicted demand patterns.
 */

import { db } from "../db";
import { trips, drivers } from "@shared/schema";
import { eq, and, gte, isNull, sql } from "drizzle-orm";
import { setJson, getJson } from "./redis";
import { cache } from "./cache";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Hotspot {
  /** Cluster center latitude */
  lat: number;
  /** Cluster center longitude */
  lng: number;
  /** Number of trips originating from this cluster */
  tripCount: number;
  /** Representative address (most common pickup in cluster) */
  representativeAddress: string;
  /** Representative zip */
  zip: string | null;
  /** Demand intensity (relative to company average) */
  intensity: number;
}

interface TimeBucketedHotspots {
  bucket: string;
  /** Hour range label */
  label: string;
  /** Start hour (inclusive) */
  startHour: number;
  /** End hour (exclusive) */
  endHour: number;
  hotspots: Hotspot[];
}

interface DriverPositionRecommendation {
  driverId: number;
  driverName: string;
  currentLat: number | null;
  currentLng: number | null;
  recommendedLat: number;
  recommendedLng: number;
  recommendedAddress: string;
  reason: string;
  expectedDemand: number;
}

export interface HotspotAnalysis {
  cityId: number;
  date: string;
  timeBuckets: TimeBucketedHotspots[];
  recommendations: DriverPositionRecommendation[];
  stats: {
    totalTripsAnalyzed: number;
    totalClusters: number;
    lookbackDays: number;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_PREFIX = "hotspots";
const CACHE_TTL = 1800; // 30 min
const LOOKBACK_DAYS = 60;
const CLUSTER_RADIUS_KM = 2.0; // Trips within 2km are considered same cluster
const MIN_CLUSTER_SIZE = 3;

const TIME_BUCKETS = [
  { bucket: "morning", label: "Morning (6-10)", startHour: 6, endHour: 10 },
  { bucket: "midday", label: "Midday (10-14)", startHour: 10, endHour: 14 },
  { bucket: "afternoon", label: "Afternoon (14-18)", startHour: 14, endHour: 18 },
  { bucket: "evening", label: "Evening (18-22)", startHour: 18, endHour: 22 },
];

// ─── Haversine ───────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Simple Clustering (density-based) ───────────────────────────────────────

interface TripPoint {
  lat: number;
  lng: number;
  address: string;
  zip: string | null;
  hour: number;
}

function clusterPoints(points: TripPoint[]): Hotspot[] {
  if (points.length === 0) return [];

  const assigned = new Set<number>();
  const clusters: TripPoint[][] = [];

  for (let i = 0; i < points.length; i++) {
    if (assigned.has(i)) continue;

    const cluster: TripPoint[] = [points[i]];
    assigned.add(i);

    for (let j = i + 1; j < points.length; j++) {
      if (assigned.has(j)) continue;
      const dist = haversineKm(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
      if (dist <= CLUSTER_RADIUS_KM) {
        cluster.push(points[j]);
        assigned.add(j);
      }
    }

    if (cluster.length >= MIN_CLUSTER_SIZE) {
      clusters.push(cluster);
    }
  }

  // Convert clusters to hotspots
  const avgTripCount = points.length / Math.max(1, clusters.length);

  return clusters.map(cluster => {
    const centerLat = cluster.reduce((s, p) => s + p.lat, 0) / cluster.length;
    const centerLng = cluster.reduce((s, p) => s + p.lng, 0) / cluster.length;

    // Most common address
    const addrCounts = new Map<string, number>();
    const zipCounts = new Map<string, number>();
    for (const p of cluster) {
      addrCounts.set(p.address, (addrCounts.get(p.address) || 0) + 1);
      if (p.zip) zipCounts.set(p.zip, (zipCounts.get(p.zip) || 0) + 1);
    }
    let bestAddr = "";
    let bestAddrCount = 0;
    for (const [addr, count] of addrCounts) {
      if (count > bestAddrCount) { bestAddr = addr; bestAddrCount = count; }
    }
    let bestZip: string | null = null;
    let bestZipCount = 0;
    for (const [zip, count] of zipCounts) {
      if (count > bestZipCount) { bestZip = zip; bestZipCount = count; }
    }

    return {
      lat: Math.round(centerLat * 10000) / 10000,
      lng: Math.round(centerLng * 10000) / 10000,
      tripCount: cluster.length,
      representativeAddress: bestAddr,
      zip: bestZip,
      intensity: Math.round((cluster.length / avgTripCount) * 100) / 100,
    };
  }).sort((a, b) => b.tripCount - a.tripCount);
}

// ─── Main Analysis ───────────────────────────────────────────────────────────

/**
 * Analyze historical trip origins to find demand clusters and recommend
 * driver pre-positioning.
 */
export async function analyzeHotspots(
  cityId: number,
  companyId: number,
  date?: string
): Promise<HotspotAnalysis> {
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const cacheKey = `${CACHE_PREFIX}:${companyId}:${cityId}:${targetDate}`;

  try {
    const cached = await getJson<HotspotAnalysis>(cacheKey);
    if (cached) return cached;
  } catch {
    const memCached = cache.get<HotspotAnalysis>(cacheKey);
    if (memCached) return memCached;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Get target day of week to filter same-day-of-week patterns
  const targetDayOfWeek = new Date(targetDate + "T12:00:00Z").getDay();

  // Fetch historical trip origins
  const historicalTrips = await db
    .select({
      pickupLat: trips.pickupLat,
      pickupLng: trips.pickupLng,
      pickupAddress: trips.pickupAddress,
      pickupZip: trips.pickupZip,
      pickupTime: trips.pickupTime,
      scheduledDate: trips.scheduledDate,
    })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.cityId, cityId),
        gte(trips.scheduledDate, cutoffStr),
        isNull(trips.deletedAt),
        sql`${trips.pickupLat} IS NOT NULL`,
        sql`${trips.pickupLng} IS NOT NULL`
      )
    );

  // Filter to same day of week and extract hour
  const points: TripPoint[] = [];
  for (const t of historicalTrips) {
    if (!t.pickupLat || !t.pickupLng) continue;

    // Match same day of week
    const tripDay = new Date(t.scheduledDate + "T12:00:00Z").getDay();
    if (tripDay !== targetDayOfWeek) continue;

    let hour = 12;
    if (t.pickupTime) {
      const match = t.pickupTime.match(/^(\d{1,2}):/);
      if (match) hour = parseInt(match[1], 10);
    }

    points.push({
      lat: t.pickupLat,
      lng: t.pickupLng,
      address: t.pickupAddress || "",
      zip: t.pickupZip,
      hour,
    });
  }

  // Cluster by time bucket
  const timeBuckets: TimeBucketedHotspots[] = TIME_BUCKETS.map(tb => {
    const bucketPoints = points.filter(p => p.hour >= tb.startHour && p.hour < tb.endHour);
    return {
      bucket: tb.bucket,
      label: tb.label,
      startHour: tb.startHour,
      endHour: tb.endHour,
      hotspots: clusterPoints(bucketPoints),
    };
  });

  // Generate driver positioning recommendations
  // Find the current time bucket and recommend positioning for it
  const currentHour = new Date().getHours();
  const currentBucket = timeBuckets.find(tb => currentHour >= tb.startHour && currentHour < tb.endHour)
    || timeBuckets[0];

  const availableDrivers = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      lastLat: drivers.lastLat,
      lastLng: drivers.lastLng,
      dispatchStatus: drivers.dispatchStatus,
    })
    .from(drivers)
    .where(
      and(
        eq(drivers.companyId, companyId),
        eq(drivers.cityId, cityId),
        eq(drivers.status, "ACTIVE"),
        eq(drivers.active, true),
        isNull(drivers.deletedAt)
      )
    );

  const onlineDrivers = availableDrivers.filter(d => d.dispatchStatus === "available");
  const recommendations: DriverPositionRecommendation[] = [];

  // Assign drivers to hotspots (greedy: assign each driver to nearest unserved hotspot)
  const hotspots = currentBucket.hotspots.slice(0, 10);
  const assignedHotspots = new Set<number>();

  for (const driver of onlineDrivers) {
    if (recommendations.length >= hotspots.length) break;

    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < hotspots.length; i++) {
      if (assignedHotspots.has(i)) continue;
      if (driver.lastLat && driver.lastLng) {
        const dist = haversineKm(driver.lastLat, driver.lastLng, hotspots[i].lat, hotspots[i].lng);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      } else {
        bestIdx = i;
        break;
      }
    }

    if (bestIdx >= 0) {
      assignedHotspots.add(bestIdx);
      const hs = hotspots[bestIdx];
      recommendations.push({
        driverId: driver.id,
        driverName: `${driver.firstName} ${driver.lastName}`,
        currentLat: driver.lastLat,
        currentLng: driver.lastLng,
        recommendedLat: hs.lat,
        recommendedLng: hs.lng,
        recommendedAddress: hs.representativeAddress || `Zone ${hs.zip || bestIdx + 1}`,
        reason: `High demand area (${hs.tripCount} historical trips, intensity ${hs.intensity}x)`,
        expectedDemand: hs.tripCount,
      });
    }
  }

  const totalClusters = timeBuckets.reduce((s, tb) => s + tb.hotspots.length, 0);

  const result: HotspotAnalysis = {
    cityId,
    date: targetDate,
    timeBuckets,
    recommendations,
    stats: {
      totalTripsAnalyzed: points.length,
      totalClusters,
      lookbackDays: LOOKBACK_DAYS,
    },
  };

  try {
    await setJson(cacheKey, result, CACHE_TTL);
  } catch {
    cache.set(cacheKey, result, CACHE_TTL * 1000);
  }

  return result;
}
