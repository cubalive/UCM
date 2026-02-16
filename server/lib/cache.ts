interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface CacheStore {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, ttlMs: number): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  keys(pattern?: string): string[];
  clear(): void;
  size(): number;
}

class InMemoryCache implements CacheStore {
  private store = new Map<string, CacheEntry<any>>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => this.evictExpired(), 30_000);
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  has(key: string): boolean {
    const val = this.get(key);
    return val !== null;
  }

  keys(pattern?: string): string[] {
    this.evictExpired();
    const allKeys = Array.from(this.store.keys());
    if (!pattern) return allKeys;
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    return allKeys.filter(k => regex.test(k));
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    this.evictExpired();
    return this.store.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

export const cache = new InMemoryCache();

export const CACHE_TTL = {
  DRIVER_LOCATION: 120_000,
  TRIP_DRIVER_LAST: 120_000,
  TRIP_ETA: 60_000,
  DRIVER_RATE_LIMIT: 5_000,
} as const;

export function cacheKeys(type: "driver_location" | "trip_driver_last" | "trip_eta" | "driver_rate" | "driver_last_persist" | "eta_last_calc", id: number | string): string {
  switch (type) {
    case "driver_location": return `driver:${id}:last_location`;
    case "trip_driver_last": return `trip:${id}:driver_last`;
    case "trip_eta": return `trip:${id}:eta`;
    case "driver_rate": return `driver:${id}:rate_limit`;
    case "driver_last_persist": return `driver:${id}:last_persist`;
    case "eta_last_calc": return `driver:${id}:eta_last_calc`;
  }
}

export interface CachedDriverLocation {
  driverId: number;
  lat: number;
  lng: number;
  timestamp: number;
  heading?: number;
  speed?: number;
}

export interface CachedEta {
  minutes: number;
  distanceMiles: number;
  computedAt: number;
  source: "google" | "haversine";
}
