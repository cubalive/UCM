import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware, requireRole, getCompanyIdFromAuth, checkCompanyOwnership, type AuthRequest } from "../auth";
import { cache, cacheKeys, CACHE_TTL, type CachedDriverLocation } from "./cache";
import { broadcastToTrip } from "./realtime";
import { broadcastTripSupabaseThrottled } from "./supabaseRealtime";
import { getJson, setJson, incr, recordRateLimited } from "./redis";
import { shouldPublishLocationRedis, recordLatencySample } from "./backpressure";
import { db } from "../db";
import { tripLocationPoints } from "@shared/schema";

const RATE_LIMIT_MS = 2000;
const MAX_SPEED_MPS = 55; // ~123 mph
const MAX_STALE_S = 60;
const MAX_BATCH_STALE_S = 600; // 10 min for offline batch
const MAX_BATCH_SIZE = 50;
const SPAM_WINDOW_MS = 10_000;
const SPAM_MAX_REQUESTS = 20;
const GPS_STALE_THRESHOLD_MS = 120_000;  // 2 min => gps_stale=true
const GPS_ETA_HIDE_THRESHOLD_MS = 300_000; // 5 min => eta=null

const singleLocationSchema = z.object({
  driver_id: z.number().int().positive().optional(),
  driverId: z.number().int().positive().optional(),
  trip_id: z.number().int().positive().optional(),
  tripId: z.number().int().positive().optional(),
  lat: z.number().min(-90).max(90).refine(v => !isNaN(v), { message: "lat must not be NaN" }),
  lng: z.number().min(-180).max(180).refine(v => !isNaN(v), { message: "lng must not be NaN" }),
  timestamp: z.number().optional(),
  ts: z.number().optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
  accuracy: z.number().min(0).optional(),
  status: z.string().optional(),
}).refine(d => !!(d.driver_id || d.driverId), { message: "driverId or driver_id required" });

const batchLocationSchema = z.object({
  points: z.array(z.object({
    driver_id: z.number().int().positive().optional(),
    driverId: z.number().int().positive().optional(),
    trip_id: z.number().int().positive().optional(),
    tripId: z.number().int().positive().optional(),
    lat: z.number().min(-90).max(90).refine(v => !isNaN(v), { message: "lat must not be NaN" }),
    lng: z.number().min(-180).max(180).refine(v => !isNaN(v), { message: "lng must not be NaN" }),
    timestamp: z.number().optional(),
    ts: z.number().optional(),
    heading: z.number().min(0).max(360).optional(),
    speed: z.number().min(0).optional(),
    accuracy: z.number().min(0).optional(),
    status: z.string().optional(),
  }).refine(d => !!(d.driver_id || d.driverId), { message: "driverId or driver_id required" })).min(1).max(MAX_BATCH_SIZE),
});

const locationRequestSchema = z.union([batchLocationSchema, singleLocationSchema]);

interface NormalizedPoint {
  driverId: number;
  tripId?: number;
  lat: number;
  lng: number;
  timestamp: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  status?: string;
}

function normalizePoint(raw: any): NormalizedPoint {
  return {
    driverId: raw.driverId || raw.driver_id,
    tripId: raw.tripId || raw.trip_id,
    lat: raw.lat,
    lng: raw.lng,
    timestamp: raw.ts || raw.timestamp || Date.now(),
    heading: raw.heading,
    speed: raw.speed,
    accuracy: raw.accuracy,
    status: raw.status,
  };
}

const metrics = {
  requestsTotal: 0,
  rejectedRateLimit: 0,
  rejectedValidation: 0,
  dbWrites: 0,
  acceptedTotal: 0,
  lastResetAt: Date.now(),

  windowRequests: 0,
  windowRejectedRateLimit: 0,
  windowRejectedValidation: 0,
  windowDbWrites: 0,
  windowStartedAt: Date.now(),
};

function resetWindow() {
  const now = Date.now();
  if (now - metrics.windowStartedAt >= 60_000) {
    metrics.windowRequests = 0;
    metrics.windowRejectedRateLimit = 0;
    metrics.windowRejectedValidation = 0;
    metrics.windowDbWrites = 0;
    metrics.windowStartedAt = now;
  }
}

function recordRequest() { metrics.requestsTotal++; metrics.windowRequests++; resetWindow(); }
function recordRejectedRateLimit() { metrics.rejectedRateLimit++; metrics.windowRejectedRateLimit++; }
function recordRejectedValidation() { metrics.rejectedValidation++; metrics.windowRejectedValidation++; }
function recordDbWrite() { metrics.dbWrites++; metrics.windowDbWrites++; }
function recordAccepted() { metrics.acceptedTotal++; }

export function getIngestMetrics() {
  resetWindow();
  const elapsedMin = Math.max(1, (Date.now() - metrics.lastResetAt) / 60_000);
  return {
    gps_ingest_requests_per_min: Math.round(metrics.windowRequests / Math.max(1, (Date.now() - metrics.windowStartedAt) / 60_000)),
    gps_ingest_rejected_rate_limit: metrics.windowRejectedRateLimit,
    gps_ingest_rejected_validation: metrics.windowRejectedValidation,
    db_location_writes_per_min: Math.round(metrics.windowDbWrites / Math.max(1, (Date.now() - metrics.windowStartedAt) / 60_000)),
    totals: {
      requests: metrics.requestsTotal,
      accepted: metrics.acceptedTotal,
      rejected_rate_limit: metrics.rejectedRateLimit,
      rejected_validation: metrics.rejectedValidation,
      db_writes: metrics.dbWrites,
      uptime_minutes: Math.round(elapsedMin),
    },
  };
}

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
  point: NormalizedPoint,
): { accepted: boolean; reason?: string } {
  const now = Date.now();
  const { driverId, lat, lng, timestamp, heading, speed } = point;

  if (Math.abs(now - timestamp) > MAX_STALE_S * 1000) {
    recordRejectedValidation();
    return { accepted: false, reason: "stale_timestamp" };
  }

  const rateKey = cacheKeys("driver_rate", driverId);
  const lastUpdate = cache.get<number>(rateKey);
  if (lastUpdate && (now - lastUpdate) < RATE_LIMIT_MS) {
    recordRejectedRateLimit();
    return { accepted: false, reason: "rate_limited" };
  }

  const locKey = cacheKeys("driver_location", driverId);
  const prev = cache.get<CachedDriverLocation>(locKey);

  if (prev && isImpossibleJump(prev, { lat, lng, timestamp })) {
    recordRejectedValidation();
    return { accepted: false, reason: "impossible_jump" };
  }

  const entry: CachedDriverLocation = { driverId, lat, lng, timestamp, heading, speed };
  cache.set(locKey, entry, CACHE_TTL.DRIVER_LOCATION);
  cache.set(rateKey, now, CACHE_TTL.DRIVER_RATE_LIMIT);
  setJson(`driver:${driverId}:last_location`, entry, 120).catch(() => {});
  recordAccepted();

  return { accepted: true };
}

function processBatchPoints(
  driverId: number,
  points: NormalizedPoint[],
): Array<{ accepted: boolean; reason?: string; historical?: boolean }> {
  const now = Date.now();
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const results: Array<{ accepted: boolean; reason?: string; historical?: boolean }> = [];

  const locKey = cacheKeys("driver_location", driverId);
  let lastValid = cache.get<CachedDriverLocation>(locKey);
  let latestAccepted: NormalizedPoint | null = null;

  for (const point of sorted) {
    const age = Math.abs(now - point.timestamp);

    if (age > MAX_BATCH_STALE_S * 1000) {
      recordRejectedValidation();
      results.push({ accepted: false, reason: "stale_timestamp" });
      continue;
    }

    if (lastValid && isImpossibleJump(
      { lat: lastValid.lat, lng: lastValid.lng, timestamp: lastValid.timestamp },
      { lat: point.lat, lng: point.lng, timestamp: point.timestamp }
    )) {
      recordRejectedValidation();
      results.push({ accepted: false, reason: "impossible_jump" });
      continue;
    }

    const isHistorical = age > MAX_STALE_S * 1000;
    results.push({ accepted: true, historical: isHistorical || undefined });
    lastValid = { driverId, lat: point.lat, lng: point.lng, timestamp: point.timestamp, heading: point.heading, speed: point.speed };
    latestAccepted = point;
    recordAccepted();
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
    setJson(`driver:${driverId}:last_location`, entry, 120).catch(() => {});
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
    trackingStatus: "OK",
  } as any);

  cache.set(persistKey, now, 120_000);
  recordDbWrite();
  return true;
}

const BREADCRUMB_INTERVAL_MS = 5_000;
const BREADCRUMB_MIN_DISTANCE_M = 20;
const breadcrumbLastTs = new Map<number, number>();

async function storeTripBreadcrumbs(driverId: number, points: NormalizedPoint[]): Promise<void> {
  const tripsForDriver = await storage.getActiveTripsForDriver(driverId);
  if (tripsForDriver.length === 0) return;

  for (const trip of tripsForDriver) {
    const tripId = trip.id;
    const lastTs = breadcrumbLastTs.get(tripId) || 0;
    const now = Date.now();

    if (now - lastTs < BREADCRUMB_INTERVAL_MS) continue;

    const validPoints = points.filter(p => p.lat !== 0 && p.lng !== 0);
    if (validPoints.length === 0) continue;

    const latestPoint = validPoints[validPoints.length - 1];

    try {
      await db.insert(tripLocationPoints).values({
        tripId,
        driverId,
        ts: new Date(latestPoint.timestamp),
        lat: latestPoint.lat,
        lng: latestPoint.lng,
        accuracyM: latestPoint.accuracy ?? null,
        speedMps: latestPoint.speed ?? null,
        headingDeg: latestPoint.heading ?? null,
        source: "gps",
      });
      breadcrumbLastTs.set(tripId, now);
    } catch (err: any) {
      console.warn(`[BREADCRUMB] Failed to store for trip ${tripId}: ${err.message}`);
    }
  }

  if (breadcrumbLastTs.size > 5000) {
    const cutoff = Date.now() - 3600_000;
    for (const [id, ts] of breadcrumbLastTs) {
      if (ts < cutoff) breadcrumbLastTs.delete(id);
    }
  }
}

const tripSequenceCounters = new Map<number, number>();

function getNextSeq(tripId: number): number {
  const seq = (tripSequenceCounters.get(tripId) || 0) + 1;
  tripSequenceCounters.set(tripId, seq);
  return seq;
}

interface CoalesceEntry {
  driverId: number;
  lat: number;
  lng: number;
  timer: ReturnType<typeof setTimeout>;
}

const COALESCE_WINDOW_MS = 5_000;
const coalesceBuffer = new Map<number, CoalesceEntry>();

function flushCoalesceEntry(tripId: number): void {
  const entry = coalesceBuffer.get(tripId);
  if (!entry) return;
  coalesceBuffer.delete(tripId);

  const seq = getNextSeq(tripId);
  const ts = Date.now();

  broadcastToTrip(tripId, {
    type: "driver_location",
    data: { driverId: entry.driverId, lat: entry.lat, lng: entry.lng, ts, seq },
  });

  broadcastTripSupabaseThrottled(tripId, {
    type: "driver_location",
    data: { driverId: entry.driverId, lat: entry.lat, lng: entry.lng, ts, seq },
  }).catch(() => {});
}

function coalesceAndPublish(tripId: number, driverId: number, lat: number, lng: number): void {
  const existing = coalesceBuffer.get(tripId);
  if (existing) {
    clearTimeout(existing.timer);
  }
  const timer = setTimeout(() => flushCoalesceEntry(tripId), COALESCE_WINDOW_MS);
  coalesceBuffer.set(tripId, { driverId, lat, lng, timer });
}

async function broadcastDriverLocation(driverId: number, lat: number, lng: number): Promise<void> {
  try {
    const allTrips = await storage.getActiveTripsForDriver(driverId);
    for (const trip of allTrips) {
      const tripLocKey = cacheKeys("trip_driver_last", trip.id);
      const locData = { driverId, lat, lng, timestamp: Date.now() };
      cache.set(tripLocKey, locData, CACHE_TTL.TRIP_DRIVER_LAST);
      setJson(`trip:${trip.id}:driver_location`, locData, 120).catch(() => {});

      const allowed = await shouldPublishLocationRedis(trip.id);
      if (!allowed) continue;

      coalesceAndPublish(trip.id, driverId, lat, lng);
    }

    if (allTrips.length > 0) {
      import("./eventBus").then(({ emitEvent }) => {
        const activeTripId = allTrips[0].id;
        emitEvent("driver.location", {
          driverId,
          tripId: activeTripId,
          lat,
          lng,
          ts: Date.now(),
        });
      }).catch(() => {});
    }

    import("./geofenceEvaluator").then(({ evaluateGeofence }) => {
      evaluateGeofence(driverId, lat, lng);
    }).catch(() => {});

    import("./rerouteDetector").then(({ evaluateReroute }) => {
      evaluateReroute(driverId, lat, lng);
    }).catch(() => {});
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
    recordDbWrite();
  }).catch((err: any) => {
    console.warn(`[LOCATION-INGEST] Status event persist error for driver ${driverId}: ${err.message}`);
  });
}

export function getDriverLocationFromCache(driverId: number): CachedDriverLocation | null {
  const key = cacheKeys("driver_location", driverId);
  return cache.get<CachedDriverLocation>(key);
}

export async function getDriverLocationFromRedis(driverId: number): Promise<CachedDriverLocation | null> {
  const memResult = getDriverLocationFromCache(driverId);
  if (memResult) return memResult;
  const redisResult = await getJson<CachedDriverLocation>(`driver:${driverId}:last_location`);
  if (redisResult) {
    cache.set(cacheKeys("driver_location", driverId), redisResult, CACHE_TTL.DRIVER_LOCATION);
  }
  return redisResult;
}

export interface GpsStaleInfo {
  gps_stale: boolean;
  stale_seconds: number | null;
  stale_reason?: string;
  hide_eta: boolean;
}

export function getGpsStaleInfo(driverId: number): GpsStaleInfo {
  const loc = getDriverLocationFromCache(driverId);
  if (!loc) {
    return { gps_stale: true, stale_seconds: null, stale_reason: "no_gps_data", hide_eta: true };
  }

  const ageMs = Date.now() - loc.timestamp;

  if (ageMs > GPS_ETA_HIDE_THRESHOLD_MS) {
    return {
      gps_stale: true,
      stale_seconds: Math.round(ageMs / 1000),
      stale_reason: "last_update_over_5min",
      hide_eta: true,
    };
  }

  if (ageMs > GPS_STALE_THRESHOLD_MS) {
    return {
      gps_stale: true,
      stale_seconds: Math.round(ageMs / 1000),
      stale_reason: "last_update_over_2min",
      hide_eta: false,
    };
  }

  return { gps_stale: false, stale_seconds: Math.round(ageMs / 1000), hide_eta: false };
}

export function registerDriverLocationRoutes(app: Express): void {
  app.post("/api/driver/location",
    authMiddleware,
    requireRole("DRIVER", "ADMIN", "DISPATCH", "SUPER_ADMIN"),
    async (req: AuthRequest, res) => {
      const reqStart = Date.now();
      try {
        recordRequest();

        const parsed = locationRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          recordRejectedValidation();
          return res.status(400).json({ ok: false, message: "Invalid request body", errors: parsed.error.issues.slice(0, 3) });
        }

        const data = parsed.data;
        const isBatch = "points" in data;
        const rawPoints = isBatch ? data.points : [data];

        if (rawPoints.length === 0) {
          return res.status(400).json({ ok: false, message: "No points provided" });
        }

        const points = rawPoints.map(normalizePoint);

        const driverId = points[0].driverId;
        const allSameDriver = points.every(p => p.driverId === driverId);
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

        // DRIVER role can only post location for their own driverId
        if (req.user?.role === "DRIVER" && req.user.driverId && req.user.driverId !== driverId) {
          return res.status(403).json({ ok: false, message: "Drivers can only update their own location" });
        }

        if (checkSpam(driverId)) {
          recordRejectedRateLimit();
          return res.status(429).json({ ok: false, message: "Too many requests — rate limited", reason: "spam_detected" });
        }

        const ipAddr = req.ip || req.socket.remoteAddress || "unknown";
        try {
          const ipCount = await incr(`rl:ip:${ipAddr}`, 60);
          if (ipCount > 60) {
            recordRejectedRateLimit();
            recordRateLimited();
            return res.status(429).json({ ok: false, message: "IP rate limit exceeded", reason: "ip_rate_limit" });
          }

          const driverCount = await incr(`rl:driver:${driverId}`, 2);
          if (driverCount > 1) {
            recordRejectedRateLimit();
            recordRateLimited();
            return res.status(429).json({
              ok: false,
              message: "Rate limited — max 1 update per 2 seconds",
              reason: "redis_rate_limit",
              retry_after_ms: RATE_LIMIT_MS,
            });
          }
        } catch (err: any) {
          console.warn(`[LOCATION-INGEST] Redis rate limit check failed, falling through: ${err.message}`);
        }

        let results: Array<{ accepted: boolean; reason?: string; historical?: boolean }>;

        if (isBatch && points.length > 1) {
          results = processBatchPoints(driverId, points);
        } else {
          const p = points[0];
          const r = processSinglePoint(p);
          results = [r];

          if (!r.accepted && r.reason === "rate_limited") {
            return res.status(429).json({
              ok: false,
              message: "Rate limited — max 1 update per 2 seconds",
              reason: "rate_limited",
              retry_after_ms: RATE_LIMIT_MS,
            });
          }
        }

        const anyAccepted = results.some(r => r.accepted);
        if (anyAccepted) {
          const lastAcceptedIdx = results.reduce((best, r, i) => r.accepted ? i : best, -1);
          const lastPoint = points[isBatch ? lastAcceptedIdx : 0];

          await maybePersistToDb(driverId, lastPoint.lat, lastPoint.lng);
          broadcastDriverLocation(driverId, lastPoint.lat, lastPoint.lng);

          const acceptedPoints = points.filter((_, i) => results[i]?.accepted);
          storeTripBreadcrumbs(driverId, acceptedPoints.length > 0 ? acceptedPoints : [lastPoint]).catch(err => {
            console.warn(`[BREADCRUMB] Background store error: ${err.message}`);
          });

          import("./breadcrumbBuffer").then(({ addBreadcrumb }) => {
            const activePoints = acceptedPoints.length > 0 ? acceptedPoints : [lastPoint];
            storage.getActiveTripsForDriver(driverId).then(activeTrips => {
              for (const trip of activeTrips) {
                for (const pt of activePoints) {
                  addBreadcrumb(trip.id, pt.lat, pt.lng, pt.timestamp);
                }
              }
            }).catch(() => {});
          }).catch(() => {});
        }

        const accepted = results.filter(r => r.accepted).length;
        const rejected = results.filter(r => !r.accepted).length;

        recordLatencySample(Date.now() - reqStart);
        res.json({
          ok: true,
          accepted,
          rejected,
          total: results.length,
          details: isBatch ? results : undefined,
        });
      } catch (err: any) {
        recordLatencySample(Date.now() - reqStart);
        console.error(`[LOCATION-INGEST] Error: ${err.message}`);
        res.status(500).json({ ok: false, message: "Internal error" });
      }
    }
  );

  app.get("/api/ops/gps-metrics",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (_req, res) => {
      const { getRedisMetrics } = await import("./redis");
      const { getBackpressureMetrics } = await import("./backpressure");
      res.json({
        ok: true,
        ...getIngestMetrics(),
        redis: getRedisMetrics(),
        backpressure: getBackpressureMetrics(),
      });
    }
  );

  app.get("/api/ops/directions-metrics",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (_req, res) => {
      try {
        const { getDirectionsMetrics } = await import("./googleMaps");
        res.json({ ok: true, ...getDirectionsMetrics() });
      } catch (err: any) {
        res.status(500).json({ ok: false, message: err.message });
      }
    }
  );
}

export { haversineDistanceMeters };
