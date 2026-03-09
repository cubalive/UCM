export type HealthState = "HEALTHY" | "GOOD" | "CRITICAL";

export interface HealthResult {
  state: HealthState;
  reason: string;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

const T = {
  dbLatencyGood: () => envInt("HEALTH_DB_LATENCY_MS_GOOD", 250),
  dbLatencyCritical: () => envInt("HEALTH_DB_LATENCY_MS_CRITICAL", 500),
  apiP95Good: () => envInt("HEALTH_API_P95_MS_GOOD", 600),
  apiP95Critical: () => envInt("HEALTH_API_P95_MS_CRITICAL", 1500),
  errorRateGood: () => envFloat("HEALTH_ERROR_RATE_GOOD", 0.01),
  errorRateCritical: () => envFloat("HEALTH_ERROR_RATE_CRITICAL", 0.03),
  importFailGood: () => envFloat("HEALTH_IMPORT_FAIL_RATE_GOOD", 0.02),
  importFailCritical: () => envFloat("HEALTH_IMPORT_FAIL_RATE_CRITICAL", 0.05),
  smsFailGood: () => envFloat("HEALTH_SMS_FAIL_RATE_GOOD", 0.02),
  smsFailCritical: () => envFloat("HEALTH_SMS_FAIL_RATE_CRITICAL", 0.05),
  driverStaleGoodSec: () => envInt("HEALTH_DRIVER_LOCATION_STALE_GOOD_SEC", 120),
  driverStaleCriticalSec: () => envInt("HEALTH_DRIVER_LOCATION_STALE_CRITICAL_SEC", 300),
};

export function getThresholds() {
  return {
    dbLatencyMsGood: T.dbLatencyGood(),
    dbLatencyMsCritical: T.dbLatencyCritical(),
    apiP95MsGood: T.apiP95Good(),
    apiP95MsCritical: T.apiP95Critical(),
    errorRateGood: T.errorRateGood(),
    errorRateCritical: T.errorRateCritical(),
    importFailRateGood: T.importFailGood(),
    importFailRateCritical: T.importFailCritical(),
    smsFailRateGood: T.smsFailGood(),
    smsFailRateCritical: T.smsFailCritical(),
    driverStaleGoodSec: T.driverStaleGoodSec(),
    driverStaleCriticalSec: T.driverStaleCriticalSec(),
  };
}

export function evaluateDbLatency(ms: number): HealthResult {
  if (ms <= T.dbLatencyGood()) return { state: "HEALTHY", reason: `Latency ${ms}ms (≤${T.dbLatencyGood()}ms)` };
  if (ms <= T.dbLatencyCritical()) return { state: "GOOD", reason: `Latency ${ms}ms (≤${T.dbLatencyCritical()}ms)` };
  return { state: "CRITICAL", reason: `Latency ${ms}ms exceeds ${T.dbLatencyCritical()}ms` };
}

export function evaluateApiP95(p95Ms: number): HealthResult {
  if (p95Ms <= T.apiP95Good()) return { state: "HEALTHY", reason: `p95 ${p95Ms}ms (≤${T.apiP95Good()}ms)` };
  if (p95Ms <= T.apiP95Critical()) return { state: "GOOD", reason: `p95 ${p95Ms}ms (≤${T.apiP95Critical()}ms)` };
  return { state: "CRITICAL", reason: `p95 ${p95Ms}ms exceeds ${T.apiP95Critical()}ms` };
}

export function evaluateErrorRate(rate: number): HealthResult {
  const pct = (rate * 100).toFixed(1);
  if (rate <= T.errorRateGood()) return { state: "HEALTHY", reason: `Error rate ${pct}% (≤${(T.errorRateGood() * 100).toFixed(1)}%)` };
  if (rate <= T.errorRateCritical()) return { state: "GOOD", reason: `Error rate ${pct}% (≤${(T.errorRateCritical() * 100).toFixed(1)}%)` };
  return { state: "CRITICAL", reason: `Error rate ${pct}% exceeds ${(T.errorRateCritical() * 100).toFixed(1)}%` };
}

export function evaluateImportFailRate(rate: number, total: number): HealthResult {
  const pct = (rate * 100).toFixed(1);
  if (total === 0) return { state: "HEALTHY", reason: "No imports in last 24h" };
  if (rate <= T.importFailGood()) return { state: "HEALTHY", reason: `Fail rate ${pct}% of ${total} jobs` };
  if (rate <= T.importFailCritical()) return { state: "GOOD", reason: `Fail rate ${pct}% of ${total} jobs` };
  return { state: "CRITICAL", reason: `Fail rate ${pct}% of ${total} jobs exceeds threshold` };
}

export function evaluateSmsFailRate(rate: number, total: number): HealthResult {
  const pct = (rate * 100).toFixed(1);
  if (total === 0) return { state: "HEALTHY", reason: "No SMS in last 24h" };
  if (rate <= T.smsFailGood()) return { state: "HEALTHY", reason: `SMS fail rate ${pct}% of ${total}` };
  if (rate <= T.smsFailCritical()) return { state: "GOOD", reason: `SMS fail rate ${pct}% of ${total}` };
  return { state: "CRITICAL", reason: `SMS fail rate ${pct}% of ${total} exceeds threshold` };
}

export function evaluateDriverStale(staleCount: number, activeCount: number): HealthResult {
  if (activeCount === 0) return { state: "HEALTHY", reason: "No active drivers" };
  const ratio = staleCount / activeCount;
  const pct = (ratio * 100).toFixed(0);
  if (ratio <= 0.1) return { state: "HEALTHY", reason: `${staleCount}/${activeCount} stale (${pct}%)` };
  if (ratio <= 0.3) return { state: "GOOD", reason: `${staleCount}/${activeCount} stale (${pct}%)` };
  return { state: "CRITICAL", reason: `${staleCount}/${activeCount} stale (${pct}%) — high staleness` };
}

export function evaluateTrips(latePickups: number, noShows: number): HealthResult {
  const total = latePickups + noShows;
  if (total === 0) return { state: "HEALTHY", reason: "No late pickups or no-shows" };
  if (total <= 5) return { state: "GOOD", reason: `${latePickups} late, ${noShows} no-shows` };
  return { state: "CRITICAL", reason: `${latePickups} late pickups, ${noShows} no-shows — needs attention` };
}

export function worstState(states: HealthState[]): HealthState {
  if (states.includes("CRITICAL")) return "CRITICAL";
  if (states.includes("GOOD")) return "GOOD";
  return "HEALTHY";
}
