import Redis from "ioredis";
import logger from "./logger.js";

let redis: Redis | null = null;
let redisAvailable = !!process.env.REDIS_URL;
let redisWarningLogged = false;

export function getRedis(): Redis | null {
  if (!redis) {
    const url = process.env.REDIS_URL;
    if (!url) {
      if (!redisWarningLogged) {
        logger.warn("Redis not available — operating without cache");
        redisWarningLogged = true;
      }
      return null;
    }
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) {
          redisAvailable = false;
          logger.warn("Redis connection failed after 5 retries, operating without Redis");
          return null;
        }
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    redis.on("error", (err) => {
      logger.error("Redis error", { error: err.message });
      redisAvailable = false;
    });

    redis.on("connect", () => {
      redisAvailable = true;
      logger.info("Redis connected");
    });
  }
  return redis;
}

export function isRedisAvailable(): boolean {
  return redisAvailable;
}

export async function checkRedisHealth(): Promise<{ connected: boolean; latencyMs?: number }> {
  try {
    const r = getRedis();
    if (!r) return { connected: false };
    const start = Date.now();
    await r.ping();
    return { connected: true, latencyMs: Date.now() - start };
  } catch {
    return { connected: false };
  }
}
