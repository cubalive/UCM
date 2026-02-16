import { cache } from "./cache";
import { getJson, setJson } from "./redis";

const PUBLISH_INTERVAL_LOCATION_NORMAL = 5_000;
const PUBLISH_INTERVAL_LOCATION_DEGRADED = 10_000;
const PUBLISH_INTERVAL_ETA = 60_000;

const DEGRADE_LATENCY_THRESHOLD_MS = 2000;
const DEGRADE_CHECK_INTERVAL_MS = 30_000;
const DEGRADE_RECOVERY_MS = 60_000;
const CONTENTION_THRESHOLD = 10;
const CONTENTION_WINDOW_MS = 60_000;

interface BackpressureMetrics {
  publish_dropped_by_throttle: number;
  publish_dropped_location: number;
  publish_dropped_eta: number;
  degrade_mode_on: boolean;
  degrade_mode_reason: string | null;
  degrade_mode_since: number | null;
  directions_timeout_count: number;
  directions_lock_contention_count: number;
}

const metrics: BackpressureMetrics = {
  publish_dropped_by_throttle: 0,
  publish_dropped_location: 0,
  publish_dropped_eta: 0,
  degrade_mode_on: false,
  degrade_mode_reason: null,
  degrade_mode_since: null,
  directions_timeout_count: 0,
  directions_lock_contention_count: 0,
};

const latencySamples: number[] = [];
const MAX_SAMPLES = 50;
const contentionTimestamps: number[] = [];

export function recordLatencySample(ms: number): void {
  latencySamples.push(ms);
  if (latencySamples.length > MAX_SAMPLES) {
    latencySamples.shift();
  }
}

function getP95Latency(): number {
  if (latencySamples.length === 0) return 0;
  const sorted = [...latencySamples].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

let lastDegradeCheck = 0;

function getRecentContentionCount(): number {
  const cutoff = Date.now() - CONTENTION_WINDOW_MS;
  while (contentionTimestamps.length > 0 && contentionTimestamps[0] < cutoff) {
    contentionTimestamps.shift();
  }
  return contentionTimestamps.length;
}

function checkDegradeMode(): void {
  const now = Date.now();
  if (now - lastDegradeCheck < DEGRADE_CHECK_INTERVAL_MS) return;
  lastDegradeCheck = now;

  const p95 = getP95Latency();
  const recentContention = getRecentContentionCount();
  const highLatency = p95 > DEGRADE_LATENCY_THRESHOLD_MS;
  const highContention = recentContention >= CONTENTION_THRESHOLD;

  if (!metrics.degrade_mode_on && (highLatency || highContention)) {
    metrics.degrade_mode_on = true;
    const reasons: string[] = [];
    if (highLatency) reasons.push(`p95_latency=${p95}ms exceeds ${DEGRADE_LATENCY_THRESHOLD_MS}ms`);
    if (highContention) reasons.push(`contention=${recentContention} exceeds ${CONTENTION_THRESHOLD}/min`);
    metrics.degrade_mode_reason = reasons.join("; ");
    metrics.degrade_mode_since = now;
    console.warn(`[BACKPRESSURE] Entering degraded mode: ${metrics.degrade_mode_reason}`);
  } else if (metrics.degrade_mode_on && !highLatency && !highContention) {
    if (metrics.degrade_mode_since && (now - metrics.degrade_mode_since) > DEGRADE_RECOVERY_MS) {
      console.log(`[BACKPRESSURE] Exiting degraded mode (p95=${p95}ms, contention=${recentContention})`);
      metrics.degrade_mode_on = false;
      metrics.degrade_mode_reason = null;
      metrics.degrade_mode_since = null;
    }
  }
}

export function isDegradeMode(): boolean {
  checkDegradeMode();
  return metrics.degrade_mode_on;
}

export function getLocationPublishInterval(): number {
  return isDegradeMode() ? PUBLISH_INTERVAL_LOCATION_DEGRADED : PUBLISH_INTERVAL_LOCATION_NORMAL;
}

export function isEtaPublishAllowed(): boolean {
  return !isDegradeMode();
}

export function shouldPublishLocation(tripId: number): boolean {
  const key = `bp:trip:${tripId}:loc:last_ts`;
  const now = Date.now();
  const lastTs = cache.get<number>(key);
  const interval = getLocationPublishInterval();

  if (lastTs && (now - lastTs) < interval) {
    metrics.publish_dropped_by_throttle++;
    metrics.publish_dropped_location++;
    return false;
  }

  cache.set(key, now, interval * 2);
  return true;
}

export async function shouldPublishLocationRedis(tripId: number): Promise<boolean> {
  const key = `trip:${tripId}:pub:last_ts`;
  const now = Date.now();

  const lastTs = cache.get<number>(`bp:trip:${tripId}:loc:last_ts`);
  const interval = getLocationPublishInterval();
  if (lastTs && (now - lastTs) < interval) {
    metrics.publish_dropped_by_throttle++;
    metrics.publish_dropped_location++;
    return false;
  }

  try {
    const redisTs = await getJson<number>(key);
    if (redisTs && (now - redisTs) < interval) {
      metrics.publish_dropped_by_throttle++;
      metrics.publish_dropped_location++;
      return false;
    }
  } catch {}

  cache.set(`bp:trip:${tripId}:loc:last_ts`, now, interval * 2);
  setJson(key, now, Math.ceil(interval / 1000)).catch(() => {});
  return true;
}

export async function shouldPublishEta(tripId: number): Promise<boolean> {
  if (!isEtaPublishAllowed()) {
    metrics.publish_dropped_by_throttle++;
    metrics.publish_dropped_eta++;
    return false;
  }

  const memKey = `bp:trip:${tripId}:eta:last_ts`;
  const redisKey = `trip:${tripId}:pub:eta_ts`;
  const now = Date.now();
  const lastTs = cache.get<number>(memKey);

  if (lastTs && (now - lastTs) < PUBLISH_INTERVAL_ETA) {
    metrics.publish_dropped_by_throttle++;
    metrics.publish_dropped_eta++;
    return false;
  }

  try {
    const redisTs = await getJson<number>(redisKey);
    if (redisTs && (now - redisTs) < PUBLISH_INTERVAL_ETA) {
      metrics.publish_dropped_by_throttle++;
      metrics.publish_dropped_eta++;
      return false;
    }
  } catch {}

  cache.set(memKey, now, PUBLISH_INTERVAL_ETA * 2);
  setJson(redisKey, now, Math.ceil(PUBLISH_INTERVAL_ETA / 1000)).catch(() => {});
  return true;
}

export function recordDirectionsTimeout(): void {
  metrics.directions_timeout_count++;
}

export function recordDirectionsLockContention(): void {
  metrics.directions_lock_contention_count++;
  contentionTimestamps.push(Date.now());
}

export function getBackpressureMetrics(): BackpressureMetrics & { p95_latency_ms: number } {
  return {
    ...metrics,
    p95_latency_ms: getP95Latency(),
  };
}
