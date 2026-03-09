/**
 * Request-level metrics collection middleware.
 * Tracks latency histograms and request counts per route/method/status.
 * Exports data for Prometheus scraping.
 */
import { Request, Response, NextFunction } from "express";

interface RequestBucket {
  count: number;
  totalMs: number;
  maxMs: number;
  errors: number;
  // Histogram buckets (ms)
  hist: Record<string, number>;
}

const HISTOGRAM_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

const metrics = new Map<string, RequestBucket>();
let totalRequests = 0;
let totalErrors = 0;
const startedAt = Date.now();

function getKey(method: string, route: string): string {
  return `${method} ${route}`;
}

function getBucket(key: string): RequestBucket {
  let b = metrics.get(key);
  if (!b) {
    b = {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      errors: 0,
      hist: Object.fromEntries(HISTOGRAM_BUCKETS.map(b => [String(b), 0])),
    };
    b.hist["+Inf"] = 0;
    metrics.set(key, b);
  }
  return b;
}

function normalizeRoute(req: Request): string {
  // Use Express route pattern if available, fallback to path
  const route = (req.route?.path as string) || req.path;
  const base = req.baseUrl || "";
  const full = `${base}${route}`;
  // Replace UUIDs with :id
  return full.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
}

export function requestMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const route = normalizeRoute(req);
    const key = getKey(req.method, route);
    const bucket = getBucket(key);

    bucket.count++;
    bucket.totalMs += durationMs;
    if (durationMs > bucket.maxMs) bucket.maxMs = durationMs;
    if (res.statusCode >= 400) bucket.errors++;

    totalRequests++;
    if (res.statusCode >= 400) totalErrors++;

    // Histogram
    for (const b of HISTOGRAM_BUCKETS) {
      if (durationMs <= b) {
        bucket.hist[String(b)]++;
      }
    }
    bucket.hist["+Inf"]++;
  });

  next();
}

export function getRequestMetricsPrometheus(): string {
  const lines: string[] = [];

  lines.push("# HELP http_requests_total Total HTTP requests");
  lines.push("# TYPE http_requests_total counter");
  lines.push(`http_requests_total ${totalRequests}`);

  lines.push("# HELP http_errors_total Total HTTP error responses (4xx/5xx)");
  lines.push("# TYPE http_errors_total counter");
  lines.push(`http_errors_total ${totalErrors}`);

  lines.push("# HELP http_request_duration_ms_avg Average request duration in ms");
  lines.push("# TYPE http_request_duration_ms_avg gauge");
  lines.push("# HELP http_request_duration_ms_max Max request duration in ms");
  lines.push("# TYPE http_request_duration_ms_max gauge");
  lines.push("# HELP http_request_count Per-route request count");
  lines.push("# TYPE http_request_count counter");
  lines.push("# HELP http_request_errors Per-route error count");
  lines.push("# TYPE http_request_errors counter");

  for (const [key, b] of metrics) {
    const [method, route] = [key.split(" ")[0], key.split(" ").slice(1).join(" ")];
    const labels = `method="${method}",route="${route}"`;
    const avgMs = b.count > 0 ? (b.totalMs / b.count).toFixed(1) : "0";
    lines.push(`http_request_duration_ms_avg{${labels}} ${avgMs}`);
    lines.push(`http_request_duration_ms_max{${labels}} ${b.maxMs.toFixed(1)}`);
    lines.push(`http_request_count{${labels}} ${b.count}`);
    lines.push(`http_request_errors{${labels}} ${b.errors}`);
  }

  // Histogram
  lines.push("# HELP http_request_duration_ms_bucket Request latency histogram");
  lines.push("# TYPE http_request_duration_ms_bucket histogram");
  for (const [key, b] of metrics) {
    const [method, route] = [key.split(" ")[0], key.split(" ").slice(1).join(" ")];
    const labels = `method="${method}",route="${route}"`;
    for (const bk of [...HISTOGRAM_BUCKETS.map(String), "+Inf"]) {
      lines.push(`http_request_duration_ms_bucket{${labels},le="${bk}"} ${b.hist[bk] || 0}`);
    }
  }

  lines.push(`# HELP process_uptime_seconds Process uptime`);
  lines.push(`# TYPE process_uptime_seconds gauge`);
  lines.push(`process_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(0)}`);

  return lines.join("\n");
}

export function getRequestMetricsSummary(): {
  totalRequests: number;
  totalErrors: number;
  routes: Array<{ method: string; route: string; count: number; avgMs: number; maxMs: number; errors: number }>;
} {
  const routes = Array.from(metrics.entries()).map(([key, b]) => {
    const [method, ...routeParts] = key.split(" ");
    return {
      method,
      route: routeParts.join(" "),
      count: b.count,
      avgMs: b.count > 0 ? Math.round(b.totalMs / b.count) : 0,
      maxMs: Math.round(b.maxMs),
      errors: b.errors,
    };
  }).sort((a, b) => b.count - a.count);

  return { totalRequests, totalErrors, routes };
}
