import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware, requireRole, getCompanyIdFromAuth, checkCompanyOwnership, type AuthRequest } from "../auth";
import { cache, cacheKeys, CACHE_TTL, type CachedDriverLocation } from "./cache";
import { broadcastToTrip } from "./realtime";

const RATE_LIMIT_MS = 2000;
const MAX_SPEED_MPS = 55; // ~123 mph
const MAX_STALE_S = 60;
const MAX_BATCH_STALE_S = 600; // 10 minutes for offline batch points
const MAX_BATCH_SIZE = 50;
const SPAM_WINDOW_MS = 10_000;
const SPAM_MAX_REQUESTS = 20;

const singleLocationSchema = z.object({
  driver_id: z.number().int().positive(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timestamp: z.number().optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
});

const batchLocationSchema = z.object({
  points: z.array(singleLocationSchema).min(1).max(MAX_BATCH_SIZE),
});

const locationRequestSchema = z.union([singleLocationSchema, batchLocationSchema]);

function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isImpossibleJump(prev: { lat: number; lng: number; timestamp: number }, curr: { lat: number; lng: number; timestamp: number }): boolean {
  const distMeters = haversineDistanceMeters(prev.lat, prev.lng, curr.lat, curr.lng);
  const timeDiffS = Math.abs(curr.timestamp - prev.timestamp) / 1000;
  if (timeDiffS < 0.5) return distMeters > 50;
  const speedMps = distMeters / timeDiffS;
  return speedMps > MAX_SPEED_MPS;
}

function checkSpam(driverId: number): boolean {
  const spamKey = `driver:${driverId}:spam_count`;
  const windowKey = `driver:${driverId}:spam_window`;
  const windowStart = cache.get<number>(windowKey);
  const now = Date.now();

  if (!windowStart || (now - windowStart) > SPAM_WINDOW_MS) {
    cache.set(windowKey, now, SPAM_WINDOW_MS);
    cache.set(spamKey, 1, SPAM_WINDOW_MS);
    return false;
  }

  const count = (cache.get<number>(spamKey) || 0) + 1;
  cache.set(spamKey, count, SPAM_WINDOW_MS);
  return count > SPAM_MAX_REQUESTS;
}

function processSinglePoint(
  driverId: number,
  lat: number,
  lng: number,
  timestamp: number,
  heading?: number,
  speed?: number,
): { accepted: boolean; reason?: string } {
  const now = Date.now();

  if (Math.abs(now - timestamp) > MAX_STALE_S * 1000) {
    return { accepted: false, reason: "stale_timestamp" };
  }

  const rateKey = cacheKeys("driver_rate", driverId);
  const lastUpdate = cache.get<number>(rateKey);
  if (lastUpdate && (now - lastUpdate) < RATE_LIMIT_MS) {
    return { accepted: false, reason: "rate_limited" };
  }

  const locKey = cacheKeys("driver_location", driverId);
  const prev = cache.get<CachedDriverLocation>(locKey);

  if (prev && isImpossibleJump(prev, { lat, lng, timestamp })) {
    return { accepted: false, reason: "impossible_jump" };
  }

  const entry: CachedDriverLocation = { driverId, lat, lng, timestamp, heading, speed };
  cache.set(locKey, entry, CACHE_TTL.DRIVER_LOCATION);
  cache.set(rateKey, now, CACHE_TTL.DRIVER_RATE_LIMIT);

  return { accepted: true };
}

function processBatchPoints(
  driverId: number,
  points: Array<{ lat: number; lng: number; timestamp: number; heading?: number; speed?: number }>,
): Array<{ accepted: boolean; reason?: string }> {
  const now = Date.now();
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const results: Array<{ accepted: boolean; reason?: string }> = [];

  const locKey = cacheKeys("driver_location", driverId);
  let lastValid = cache.get<CachedDriverLocation>(locKey);
  let latestAccepted: { lat: number; lng: number; timestamp: number; heading?: number; speed?: number } | null = null;

  for (const point of sorted) {
    if (Math.abs(now - point.timestamp) > MAX_BATCH_STALE_S * 1000) {
      results.push({ accepted: false, reason: "stale_timestamp" });
      continue;
    }

    if (lastValid && isImpossibleJump(
      { lat: lastValid.lat, lng: lastValid.lng, timestamp: lastValid.timestamp },
      { lat: point.lat, lng: point.lng, timestamp: point.timestamp }
    )) {
      results.push({ accepted: false, reason: "impossible_jump" });
      continue;
    }

    results.push({ accepted: true });
    lastValid = { driverId, lat: point.lat, lng: point.lng, timestamp: point.timestamp, heading: point.heading, speed: point.speed };
    latestAccepted = point;
  }

  if (latestAccepted) {
    const entry: CachedDriverLocation = {
      driverId,
      lat: latestAccepted.lat,
      lng: latestAccepted.lng,
      timestamp: latestAccepted.timestamp,
      heading: latestAccepted.heading,
      speed: latestAccepted.speed,
    };
    cache.set(locKey, entry, CACHE_TTL.DRIVER_LOCATION);
    const rateKey = cacheKeys("driver_rate", driverId);
    cache.set(rateKey, now, CACHE_TTL.DRIVER_RATE_LIMIT);
  }

  return results;
}

async function maybePersistToDb(driverId: number, lat: number, lng: number): Promise<boolean> {
  const persistKey = cacheKeys("driver_last_persist", driverId);
  const lastPersist = cache.get<number>(persistKey);
  const now = Date.now();

  if (lastPersist && (now - lastPersist) < 60_000) {
    return false;
  }

  await storage.updateDriver(driverId, {
    lastLat: lat,
    lastLng: lng,
    lastSeenAt: new Date(),
  } as any);

  cache.set(persistKey, now, 120_000);
  return true;
}

async function broadcastDriverLocation(driverId: number, lat: number, lng: number): Promise<void> {
  try {
    const allTrips = await storage.getActiveTripsForDriver(driverId);
    for (const trip of allTrips) {
      const tripLocKey = cacheKeys("trip_driver_last", trip.id);
      cache.set(tripLocKey, { driverId, lat, lng, timestamp: Date.now() }, CACHE_TTL.TRIP_DRIVER_LAST);

      broadcastToTrip(trip.id, {
        type: "driver_location",
        data: { driverId, lat, lng, ts: Date.now() },
      });
    }
  } catch (err: any) {
    console.warn(`[LOCATION-INGEST] Broadcast error for driver ${driverId}: ${err.message}`);
  }
}

export function persistOnStatusEvent(driverId: number, lat: number, lng: number): void {
  const persistKey = cacheKeys("driver_last_persist", driverId);
  storage.updateDriver(driverId, {
    lastLat: lat,
    lastLng: lng,
    lastSeenAt: new Date(),
  } as any).then(() => {
    cache.set(persistKey, Date.now(), 120_000);
  }).catch((err: any) => {
    console.warn(`[LOCATION-INGEST] Status event persist error for driver ${driverId}: ${err.message}`);
  });
}

export function getDriverLocationFromCache(driverId: number): CachedDriverLocation | null {
  const key = cacheKeys("driver_location", driverId);
  return cache.get<CachedDriverLocation>(key);
}

export function registerDriverLocationRoutes(app: Express): void {
  app.post("/api/driver/location",
    authMiddleware,
    requireRole("DRIVER", "ADMIN", "DISPATCH", "SUPER_ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const parsed = locationRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ ok: false, message: "Invalid request body", errors: parsed.error.issues.slice(0, 3) });
        }

        const data = parsed.data;
        const isBatch = "points" in data;
        const points = isBatch ? data.points : [data];

        if (points.length === 0) {
          return res.status(400).json({ ok: false, message: "No points provided" });
        }

        const driverId = points[0].driver_id;
        const allSameDriver = points.every(p => p.driver_id === driverId);
        if (!allSameDriver) {
          return res.status(400).json({ ok: false, message: "All points in a batch must be for the same driver" });
        }

        const driver = await storage.getDriver(driverId);
        if (!driver) {
          return res.status(404).json({ ok: false, message: "Driver not found" });
        }
        const companyId = getCompanyIdFromAuth(req);
        if (!checkCompanyOwnership(driver, companyId)) {
          return res.status(403).json({ ok: false, message: "Access denied" });
        }

        if (checkSpam(driverId)) {
          return res.status(429).json({ ok: false, message: "Too many requests", reason: "spam_detected" });
        }

        const pointsWithTs = points.map(p => ({
          ...p,
          timestamp: p.timestamp || Date.now(),
        }));

        let results: Array<{ accepted: boolean; reason?: string }>;

        if (isBatch && pointsWithTs.length > 1) {
          results = processBatchPoints(driverId, pointsWithTs);
        } else {
          const p = pointsWithTs[0];
          results = [processSinglePoint(driverId, p.lat, p.lng, p.timestamp, p.heading, p.speed)];
        }

        const anyAccepted = results.some(r => r.accepted);
        if (anyAccepted) {
          const lastAcceptedIdx = results.reduce((best, r, i) => r.accepted ? i : best, -1);
          const lastPoint = pointsWithTs[isBatch ? lastAcceptedIdx : 0];

          await maybePersistToDb(driverId, lastPoint.lat, lastPoint.lng);
          broadcastDriverLocation(driverId, lastPoint.lat, lastPoint.lng);
        }

        const accepted = results.filter(r => r.accepted).length;
        const rejected = results.filter(r => !r.accepted).length;

        res.json({
          ok: true,
          accepted,
          rejected,
          total: results.length,
          details: isBatch ? results : undefined,
        });
      } catch (err: any) {
        console.error(`[LOCATION-INGEST] Error: ${err.message}`);
        res.status(500).json({ ok: false, message: "Internal error" });
      }
    }
  );
}

export { haversineDistanceMeters };
