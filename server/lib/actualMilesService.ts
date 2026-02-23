import { db } from "../db";
import { trips, tripLocationPoints } from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { storage } from "../storage";
import { getJson } from "./redis";

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface GpsPoint {
  lat: number;
  lng: number;
  ts?: number;
  accuracyM?: number | null;
}

const GPS_ACCURACY_THRESHOLD = 50;
const MAX_JUMP_METERS = 805;
const MIN_JUMP_TIME_S = 30;

function filterOutliers(points: GpsPoint[], maxSpeedMps: number = 55): GpsPoint[] {
  if (points.length < 2) return points;
  const filtered: GpsPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = filtered[filtered.length - 1];
    const curr = points[i];
    if (curr.accuracyM != null && curr.accuracyM > GPS_ACCURACY_THRESHOLD) continue;
    const dist = haversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);
    const timeDiff = curr.ts && prev.ts ? (curr.ts - prev.ts) / 1000 : 10;
    if (timeDiff <= 0) continue;
    if (dist > MAX_JUMP_METERS && timeDiff < MIN_JUMP_TIME_S) {
      const speed = dist / timeDiff;
      if (speed > maxSpeedMps) continue;
    }
    const speed = dist / timeDiff;
    if (speed <= maxSpeedMps) {
      filtered.push(curr);
    }
  }
  return filtered;
}

function computeHaversineTotal(points: GpsPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(
      points[i - 1].lat, points[i - 1].lng,
      points[i].lat, points[i].lng
    );
  }
  return total;
}

const MIN_POINTS_FOR_GPS = 10;

export async function computeActualDistance(tripId: number): Promise<void> {
  const trip = await storage.getTrip(tripId);
  if (!trip) return;

  if (trip.actualDistanceMeters != null && trip.actualDistanceSource === "gps") {
    return;
  }

  let gpsPoints: GpsPoint[] = [];

  try {
    const dbPoints = await db.select({
      lat: tripLocationPoints.lat,
      lng: tripLocationPoints.lng,
      ts: tripLocationPoints.ts,
      accuracyM: tripLocationPoints.accuracyM,
    }).from(tripLocationPoints)
      .where(eq(tripLocationPoints.tripId, tripId))
      .orderBy(tripLocationPoints.ts);

    if (dbPoints.length >= 2) {
      gpsPoints = dbPoints.map(p => ({
        lat: p.lat,
        lng: p.lng,
        ts: p.ts ? new Date(p.ts).getTime() : undefined,
        accuracyM: p.accuracyM,
      }));
      console.log(`[ACTUAL-MILES] Trip ${tripId}: Found ${dbPoints.length} DB GPS points`);
    }
  } catch (err: any) {
    console.warn(`[ACTUAL-MILES] Trip ${tripId}: DB GPS fetch failed: ${err.message}`);
  }

  if (gpsPoints.length < 2) {
    try {
      const gpsTrack = await getJson<GpsPoint[]>(`trip:${tripId}:gps_track`);
      if (gpsTrack && gpsTrack.length >= 2) {
        gpsPoints = gpsTrack;
        console.log(`[ACTUAL-MILES] Trip ${tripId}: Fallback to Redis GPS (${gpsTrack.length} points)`);
      }
    } catch {}
  }

  if (gpsPoints.length >= MIN_POINTS_FOR_GPS) {
    const filtered = filterOutliers(gpsPoints);
    if (filtered.length >= 2) {
      const totalMeters = Math.round(computeHaversineTotal(filtered));
      await db.update(trips).set({
        actualDistanceMeters: totalMeters,
        actualDistanceSource: "gps",
        updatedAt: new Date(),
      }).where(eq(trips.id, tripId));
      console.log(`[ACTUAL-MILES] Trip ${tripId}: GPS-based distance = ${totalMeters}m (${filtered.length}/${gpsPoints.length} points)`);
      return;
    }
  }

  if (trip.routeDistanceMeters) {
    await db.update(trips).set({
      actualDistanceMeters: trip.routeDistanceMeters,
      actualDistanceSource: "estimated",
      updatedAt: new Date(),
    }).where(eq(trips.id, tripId));
    console.log(`[ACTUAL-MILES] Trip ${tripId}: Fallback to route distance = ${trip.routeDistanceMeters}m (${gpsPoints.length} GPS points insufficient)`);
  }
}
