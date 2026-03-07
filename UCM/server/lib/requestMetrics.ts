const ROLLING_WINDOW_MS = 5 * 60 * 1000;

interface RouteEntry {
  method: string;
  path: string;
  latencies: number[];
  timestamps: number[];
  errorCount: number;
  errorTimestamps: number[];
  error4xxTimestamps: number[];
  error5xxTimestamps: number[];
}

const routeMap = new Map<string, RouteEntry>();

function pruneEntries(entry: RouteEntry): void {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;

  while (entry.timestamps.length > 0 && entry.timestamps[0] < cutoff) {
    entry.timestamps.shift();
    entry.latencies.shift();
  }
  while (entry.errorTimestamps.length > 0 && entry.errorTimestamps[0] < cutoff) {
    entry.errorTimestamps.shift();
    entry.errorCount = Math.max(0, entry.errorCount - 1);
  }
  while (entry.error4xxTimestamps.length > 0 && entry.error4xxTimestamps[0] < cutoff) {
    entry.error4xxTimestamps.shift();
  }
  while (entry.error5xxTimestamps.length > 0 && entry.error5xxTimestamps[0] < cutoff) {
    entry.error5xxTimestamps.shift();
  }
}

function normalizeRoute(path: string): string {
  return path
    .replace(/\/\d+/g, "/:id")
    .replace(/\/[0-9a-f]{8,}/g, "/:id")
    .replace(/\?.*$/, "");
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function recordRequest(method: string, rawPath: string, statusCode: number, durationMs: number): void {
  const path = normalizeRoute(rawPath);
  const key = `${method} ${path}`;
  const now = Date.now();

  let entry = routeMap.get(key);
  if (!entry) {
    entry = { method, path, latencies: [], timestamps: [], errorCount: 0, errorTimestamps: [], error4xxTimestamps: [], error5xxTimestamps: [] };
    routeMap.set(key, entry);
  }

  pruneEntries(entry);

  entry.timestamps.push(now);
  entry.latencies.push(durationMs);

  if (statusCode >= 400) {
    entry.errorCount++;
    entry.errorTimestamps.push(now);
    if (statusCode >= 500) {
      entry.error5xxTimestamps.push(now);
    } else {
      entry.error4xxTimestamps.push(now);
    }
  }
}

function countInWindow(timestamps: number[], windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  let count = 0;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (timestamps[i] >= cutoff) count++;
    else break;
  }
  return count;
}

export function getRequestMetricsSummary(): {
  total_requests_5min: number;
  total_errors_5min: number;
  error_rate_pct: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  rpm_1min: number;
  rpm_5min: number;
  rpm_15min: number;
  errors_4xx_5min: number;
  errors_5xx_5min: number;
} {
  let totalRequests = 0;
  let totalErrors = 0;
  const allLatencies: number[] = [];
  let req1 = 0, req5 = 0, req15 = 0;
  let err4xx = 0, err5xx = 0;

  routeMap.forEach((entry) => {
    pruneEntries(entry);
    totalRequests += entry.timestamps.length;
    totalErrors += entry.errorTimestamps.length;
    allLatencies.push(...entry.latencies);
    req1 += countInWindow(entry.timestamps, 60_000);
    req5 += countInWindow(entry.timestamps, 300_000);
    req15 += countInWindow(entry.timestamps, 900_000);
    err4xx += entry.error4xxTimestamps.length;
    err5xx += entry.error5xxTimestamps.length;
  });

  const sorted = allLatencies.sort((a, b) => a - b);

  return {
    total_requests_5min: totalRequests,
    total_errors_5min: totalErrors,
    error_rate_pct: totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 10000) / 100 : 0,
    p50_latency_ms: percentile(sorted, 0.5),
    p95_latency_ms: percentile(sorted, 0.95),
    rpm_1min: req1,
    rpm_5min: Math.round(req5 / 5),
    rpm_15min: Math.round(req15 / 15),
    errors_4xx_5min: err4xx,
    errors_5xx_5min: err5xx,
  };
}

export function getTopRoutes(limit = 20): Array<{
  route: string;
  request_count: number;
  error_count: number;
  p50_ms: number;
  p95_ms: number;
}> {
  const results: Array<{
    route: string;
    request_count: number;
    error_count: number;
    p50_ms: number;
    p95_ms: number;
  }> = [];

  routeMap.forEach((entry, key) => {
    pruneEntries(entry);
    if (entry.timestamps.length === 0) return;

    const sorted = [...entry.latencies].sort((a, b) => a - b);
    results.push({
      route: key,
      request_count: entry.timestamps.length,
      error_count: entry.errorTimestamps.length,
      p50_ms: percentile(sorted, 0.5),
      p95_ms: percentile(sorted, 0.95),
    });
  });

  results.sort((a, b) => b.request_count - a.request_count);
  return results.slice(0, limit);
}
