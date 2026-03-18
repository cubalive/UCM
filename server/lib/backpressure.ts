import { cache } from "./cache";
import { getJson, setJson } from "./redis";

const PUBLISH_INTERVALS = [5_000, 10_000, 15_000] as const;
const PUBLISH_INTERVAL_ETA = 60_000;

const DEGRADE_TIER1_LATENCY_MS = 1500;
const DEGRADE_TIER2_LATENCY_MS = 3000;
const DEGRADE_CHECK_INTERVAL_MS = 15_000;
const DEGRADE_RECOVERY_MS = 60_000;
const CONTENTION_TIER1 = 8;
const CONTENTION_TIER2 = 20;
const CONTENTION_WINDOW_MS = 60_000;

type DegradeTier = 0 | 1 | 2;

interface BackpressureMetrics {
  publish_dropped_by_throttle: number;
  publish_dropped_location: number;
  publish_dropped_eta: number;
  degrade_mode_on: boolean;
  degrade_tier: DegradeTier;
  degrade_mode_reason: string | null;
  degrade_mode_since: number | null;
  publish_interval_ms: number;
  directions_timeout_count: number;
  directions_lock_contention_count: number;
}

const metrics: BackpressureMetrics = {
  publish_dropped_by_throttle: 0,
  publish_dropped_location: 0,
  publish_dropped_eta: 0,
  degrade_mode_on: false,
  degrade_tier: 0,
  degrade_mode_reason: null,
  degrade_mode_since: null,
  publish_interval_ms: PUBLISH_INTERVALS[0],
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

function computeDegradeTier(): { tier: DegradeTier; reason: string | null } {
  const p95 = getP95Latency();
  const recentContention = getRecentContentionCount();

  if (p95 > DEGRADE_TIER2_LATENCY_MS || recentContention >= CONTENTION_TIER2) {
    const reasons: string[] = [];
    if (p95 > DEGRADE_TIER2_LATENCY_MS) reasons.push(`p95=${p95}ms>${DEGRADE_TIER2_LATENCY_MS}ms`);
    if (recentContention >= CONTENTION_TIER2) reasons.push(`contention=${recentContention}>=${CONTENTION_TIER2}/min`);
    return { tier: 2, reason: reasons.join("; ") };
  }

  if (p95 > DEGRADE_TIER1_LATENCY_MS || recentContention >= CONTENTION_TIER1) {
    const reasons: string[] = [];
    if (p95 > DEGRADE_TIER1_LATENCY_MS) reasons.push(`p95=${p95}ms>${DEGRADE_TIER1_LATENCY_MS}ms`);
    if (recentContention >= CONTENTION_TIER1) reasons.push(`contention=${recentContention}>=${CONTENTION_TIER1}/min`);
    return { tier: 1, reason: reasons.join("; ") };
  }

  return { tier: 0, reason: null };
}

function checkDegradeMode(): void {
  const now = Date.now();
  if (now - lastDegradeCheck < DEGRADE_CHECK_INTERVAL_MS) return;
  lastDegradeCheck = now;

  const { tier, reason } = computeDegradeTier();

  if (tier > metrics.degrade_tier) {
    metrics.degrade_tier = tier;
    metrics.degrade_mode_on = true;
    metrics.degrade_mode_reason = reason;
    metrics.degrade_mode_since = metrics.degrade_mode_since || now;
    metrics.publish_interval_ms = PUBLISH_INTERVALS[tier];
    console.warn(`[BACKPRESSURE] Escalated to tier ${tier} (interval=${PUBLISH_INTERVALS[tier]}ms): ${reason}`);
  } else if (tier < metrics.degrade_tier) {
    if (metrics.degrade_mode_since && (now - metrics.degrade_mode_since) > DEGRADE_RECOVERY_MS) {
      const prevTier = metrics.degrade_tier;
      metrics.degrade_tier = tier;
      metrics.degrade_mode_on = tier > 0;
      metrics.degrade_mode_reason = reason;
      metrics.publish_interval_ms = PUBLISH_INTERVALS[tier];
      if (tier === 0) metrics.degrade_mode_since = null;
      console.log(`[BACKPRESSURE] De-escalated from tier ${prevTier} to ${tier} (interval=${PUBLISH_INTERVALS[tier]}ms)`);
    }
  }
}

export function isDegradeMode(): boolean {
  checkDegradeMode();
  return metrics.degrade_mode_on;
}

export function getDegradeTier(): DegradeTier {
  checkDegradeMode();
  return metrics.degrade_tier;
}

export function getLocationPublishInterval(): number {
  checkDegradeMode();
  return PUBLISH_INTERVALS[metrics.degrade_tier];
}

export function isEtaPublishAllowed(): boolean {
  return getDegradeTier() < 2;
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
  setJson(key, now, Math.ceil(interval / 1000)).catch((err: any) => { if (err) console.error("[CATCH]", err.message || err); });
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
  setJson(redisKey, now, Math.ceil(PUBLISH_INTERVAL_ETA / 1000)).catch((err: any) => { if (err) console.error("[CATCH]", err.message || err); });
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
