import { db } from "../db";
import { trips, tripLocationPoints } from "@shared/schema";
import { eq, asc } from "drizzle-orm";

function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function filterOutliers(points: Array<{ lat: number; lng: number; ts: Date }>, maxSpeedMps: number = 55): Array<{ lat: number; lng: number; ts: Date }> {
  if (points.length < 2) return points;
  const filtered = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = filtered[filtered.length - 1];
    const curr = points[i];
    const dist = haversineDistanceMeters(prev.lat, prev.lng, curr.lat, curr.lng);
    const timeDiff = (curr.ts.getTime() - prev.ts.getTime()) / 1000;
    if (timeDiff <= 0) continue;
    const speed = dist / timeDiff;
    if (speed <= maxSpeedMps) {
      filtered.push(curr);
    }
  }
  return filtered;
}

function computeHaversineTotal(points: Array<{ lat: number; lng: number }>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceMeters(
      points[i - 1].lat, points[i - 1].lng,
      points[i].lat, points[i].lng
    );
  }
  return total;
}

function encodePolyline(points: Array<{ lat: number; lng: number }>): string {
  let encoded = "";
  let prevLat = 0;
  let prevLng = 0;

  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);

    encoded += encodeValue(lat - prevLat);
    encoded += encodeValue(lng - prevLng);

    prevLat = lat;
    prevLng = lng;
  }

  return encoded;
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let encoded = "";
  while (v >= 0x20) {
    encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  encoded += String.fromCharCode(v + 63);
  return encoded;
}

function simplifyPoints(points: Array<{ lat: number; lng: number; ts: Date }>, tolerance: number = 0.00005): Array<{ lat: number; lng: number; ts: Date }> {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPoints(points.slice(0, maxIdx + 1), tolerance);
    const right = simplifyPoints(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function perpendicularDistance(
  point: { lat: number; lng: number },
  lineStart: { lat: number; lng: number },
  lineEnd: { lat: number; lng: number }
): number {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) return haversineDistanceMeters(point.lat, point.lng, lineStart.lat, lineStart.lng) / 111320;

  const u = ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / (mag * mag);
  const closestLng = lineStart.lng + u * dx;
  const closestLat = lineStart.lat + u * dy;

  return Math.sqrt(
    (point.lat - closestLat) ** 2 + (point.lng - closestLng) ** 2
  );
}

function computeQualityScore(
  rawCount: number,
  filteredCount: number,
  actualDurationSeconds: number
): number {
  if (rawCount === 0) return 0;

  const outlierRatio = rawCount > 0 ? filteredCount / rawCount : 0;
  const pointsPerMinute = actualDurationSeconds > 0 ? (filteredCount / (actualDurationSeconds / 60)) : 0;

  let score = 0;

  if (filteredCount >= 20) score += 30;
  else if (filteredCount >= 10) score += 20;
  else if (filteredCount >= 5) score += 10;

  if (outlierRatio >= 0.9) score += 30;
  else if (outlierRatio >= 0.7) score += 20;
  else if (outlierRatio >= 0.5) score += 10;

  if (pointsPerMinute >= 3) score += 40;
  else if (pointsPerMinute >= 1) score += 30;
  else if (pointsPerMinute >= 0.5) score += 20;
  else if (pointsPerMinute > 0) score += 10;

  return Math.min(100, score);
}

export async function finalizeTripRoute(tripId: number): Promise<void> {
  try {
    const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
    if (!trip) return;

    const rawPoints = await db
      .select()
      .from(tripLocationPoints)
      .where(eq(tripLocationPoints.tripId, tripId))
      .orderBy(asc(tripLocationPoints.ts));

    let waitingSeconds: number | null = null;
    if (trip.arrivedPickupAt && trip.pickedUpAt) {
      waitingSeconds = Math.round(
        (trip.pickedUpAt.getTime() - trip.arrivedPickupAt.getTime()) / 1000
      );
      if (waitingSeconds < 0) waitingSeconds = 0;
    } else if (trip.waitingStartedAt && trip.waitingEndedAt) {
      waitingSeconds = Math.round(
        (trip.waitingEndedAt.getTime() - trip.waitingStartedAt.getTime()) / 1000
      );
      if (waitingSeconds < 0) waitingSeconds = 0;
    }

    let actualDurationSeconds: number | null = null;
    if (trip.startedAt && trip.completedAt) {
      actualDurationSeconds = Math.round(
        (trip.completedAt.getTime() - trip.startedAt.getTime()) / 1000
      );
      if (actualDurationSeconds < 0) actualDurationSeconds = 0;
    }

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (waitingSeconds !== null) {
      updateData.waitingSeconds = waitingSeconds;
    }
    if (actualDurationSeconds !== null) {
      updateData.actualDurationSeconds = actualDurationSeconds;
    }

    if (rawPoints.length >= 2) {
      const filtered = filterOutliers(rawPoints);

      if (filtered.length >= 2) {
        const totalMeters = Math.round(computeHaversineTotal(filtered));
        const quality = computeQualityScore(rawPoints.length, filtered.length, actualDurationSeconds || 0);

        const simplified = simplifyPoints(filtered);
        const actualPolyline = encodePolyline(simplified);

        updateData.actualDistanceMeters = totalMeters;
        updateData.actualDistanceSource = "gps";
        updateData.actualPolyline = actualPolyline;
        updateData.routeSource = "telemetry";
        updateData.routeQualityScore = quality;
        updateData.distanceMiles = String(Math.round((totalMeters / 1609.344) * 10) / 10);
        if (actualDurationSeconds != null) {
          updateData.durationMinutes = Math.round(actualDurationSeconds / 60);
        }

        console.log(
          `[FINALIZE] Trip ${tripId}: ${rawPoints.length} raw → ${filtered.length} clean → ${simplified.length} simplified, ` +
          `distance=${totalMeters}m, quality=${quality}, waiting=${waitingSeconds ?? 0}s, duration=${actualDurationSeconds ?? 0}s`
        );
      } else {
        updateData.routeSource = "telemetry";
        updateData.routeQualityScore = computeQualityScore(rawPoints.length, filtered.length, actualDurationSeconds || 0);
        console.log(`[FINALIZE] Trip ${tripId}: Too few clean points (${filtered.length}/${rawPoints.length})`);
      }
    } else {
      if (trip.routeDistanceMeters && !trip.actualDistanceMeters) {
        updateData.actualDistanceMeters = trip.routeDistanceMeters;
        updateData.actualDistanceSource = "estimated";
      }
      updateData.routeSource = trip.routePolyline ? "routes_api" : "fallback";
      updateData.routeQualityScore = 0;
      console.log(`[FINALIZE] Trip ${tripId}: No GPS breadcrumbs (${rawPoints.length} points), using route fallback`);
    }

    await db.update(trips).set(updateData).where(eq(trips.id, tripId));

  } catch (err: any) {
    console.error(`[FINALIZE] Error for trip ${tripId}: ${err.message}`);
  }
}
