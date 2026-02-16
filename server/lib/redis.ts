import { Redis } from "@upstash/redis";
import { cache } from "./cache";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

let redis: Redis | null = null;
let lastError: string | null = null;
let connected = false;

const redisMetrics = {
  hits: 0,
  misses: 0,
  sets: 0,
  gets: 0,
  errors: 0,
  rateLimited: 0,
  lockContention: 0,
};

const keyCategoryHits: Record<string, number> = {
  "trip:eta": 0,
  "trip:polyline": 0,
  "trip:driver_location": 0,
};
const keyCategoryMisses: Record<string, number> = {
  "trip:eta": 0,
  "trip:polyline": 0,
  "trip:driver_location": 0,
};

function classifyKey(key: string): string | null {
  if (key.match(/^trip:\d+:eta/)) return "trip:eta";
  if (key.match(/^trip:\d+:polyline/)) return "trip:polyline";
  if (key.match(/^trip:\d+:driver_location/)) return "trip:driver_location";
  return null;
}

if (UPSTASH_URL && UPSTASH_TOKEN) {
  try {
    redis = new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN });
    connected = true;
    console.log("[REDIS] Upstash Redis client initialized (REST mode)");
  } catch (err: any) {
    lastError = err.message;
    console.warn(`[REDIS] Failed to initialize: ${err.message}. Falling back to in-memory cache.`);
  }
} else {
  console.warn("[REDIS] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set. Using in-memory cache fallback.");
}

export async function getJson<T>(key: string): Promise<T | null> {
  redisMetrics.gets++;
  const cat = classifyKey(key);
  if (!redis) {
    return cache.get<T>(key);
  }
  try {
    const val = await redis.get<T>(key);
    if (val !== null && val !== undefined) {
      redisMetrics.hits++;
      if (cat) keyCategoryHits[cat]++;
      return val;
    }
    redisMetrics.misses++;
    if (cat) keyCategoryMisses[cat]++;
    return null;
  } catch (err: any) {
    redisMetrics.errors++;
    lastError = err.message;
    console.warn(`[REDIS] getJson error for "${key}": ${err.message}`);
    return cache.get<T>(key);
  }
}

export async function setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  cache.set(key, value, ttlSeconds * 1000);

  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
    redisMetrics.sets++;
  } catch (err: any) {
    redisMetrics.errors++;
    lastError = err.message;
    console.warn(`[REDIS] setJson error for "${key}": ${err.message}`);
  }
}

export async function del(key: string): Promise<void> {
  cache.delete(key);
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (err: any) {
    redisMetrics.errors++;
    lastError = err.message;
  }
}

export async function incr(key: string, ttlSeconds: number): Promise<number> {
  if (!redis) {
    const current = cache.get<number>(key) || 0;
    const next = current + 1;
    cache.set(key, next, ttlSeconds * 1000);
    return next;
  }
  try {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, ttlSeconds);
    const results = await pipeline.exec();
    const val = results[0] as number;
    return val;
  } catch (err: any) {
    redisMetrics.errors++;
    lastError = err.message;
    console.warn(`[REDIS] incr error for "${key}": ${err.message}`);
    const current = cache.get<number>(key) || 0;
    const next = current + 1;
    cache.set(key, next, ttlSeconds * 1000);
    return next;
  }
}

export async function setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  if (!redis) {
    if (cache.has(key)) return false;
    cache.set(key, value, ttlSeconds * 1000);
    return true;
  }
  try {
    const result = await redis.set(key, value, { nx: true, ex: ttlSeconds });
    return result === "OK";
  } catch (err: any) {
    redisMetrics.errors++;
    lastError = err.message;
    console.warn(`[REDIS] setNx error for "${key}": ${err.message}`);
    if (cache.has(key)) return false;
    cache.set(key, value, ttlSeconds * 1000);
    return true;
  }
}

export function isRedisConnected(): boolean {
  return connected && redis !== null;
}

export function getLastRedisError(): string | null {
  return lastError;
}

export function getRedisMetrics() {
  const total = redisMetrics.hits + redisMetrics.misses;
  return {
    redis_connected: isRedisConnected(),
    redis_get_count: redisMetrics.gets,
    redis_set_count: redisMetrics.sets,
    cache_hit_rate: total > 0 ? Math.round((redisMetrics.hits / total) * 100) : 0,
    cache_hits: redisMetrics.hits,
    cache_misses: redisMetrics.misses,
    cache_errors: redisMetrics.errors,
    gps_rate_limited_count: redisMetrics.rateLimited,
    eta_lock_contention_count: redisMetrics.lockContention,
    cache_by_key: {
      "trip:eta": { hits: keyCategoryHits["trip:eta"], misses: keyCategoryMisses["trip:eta"] },
      "trip:polyline": { hits: keyCategoryHits["trip:polyline"], misses: keyCategoryMisses["trip:polyline"] },
      "trip:driver_location": { hits: keyCategoryHits["trip:driver_location"], misses: keyCategoryMisses["trip:driver_location"] },
    },
    last_error: lastError,
  };
}

export function recordRateLimited() {
  redisMetrics.rateLimited++;
}

export function recordLockContention() {
  redisMetrics.lockContention++;
}

export async function pingRedis(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  if (!redis) {
    return { ok: false, latencyMs: 0, error: "Redis not configured" };
  }
  const start = Date.now();
  try {
    await redis.ping();
    connected = true;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    connected = false;
    lastError = err.message;
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}
