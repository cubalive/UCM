import type { Request, Response, NextFunction, Express } from "express";

// ── Types ────────────────────────────────────────────────────────────────

interface RequestRecord {
  path: string;
  method: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
}

interface EndpointStats {
  path: string;
  method: string;
  count: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

interface PerformanceSnapshot {
  windowMinutes: number;
  totalRequests: number;
  requestsPerMinute: number;
  statusCodeDistribution: Record<string, number>;
  avgDurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  slowestEndpoints: EndpointStats[];
  generatedAt: string;
}

// ── In-memory rolling store ──────────────────────────────────────────────

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_RECORDS = 50_000; // cap to prevent memory bloat

let records: RequestRecord[] = [];

function pruneOldRecords(): void {
  const cutoff = Date.now() - WINDOW_MS;
  // Binary search would be faster but linear scan is fine at ≤50k entries
  const idx = records.findIndex((r) => r.timestamp >= cutoff);
  if (idx > 0) {
    records = records.slice(idx);
  } else if (idx === -1) {
    records = [];
  }
}

// ── Middleware ────────────────────────────────────────────────────────────

/**
 * Express middleware that records request duration and status code.
 * Lightweight — no external dependencies, stores data in a rolling 1-hour window.
 */
export function performanceTracker(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationMs = Math.round(durationNs / 1_000_000);

    // Normalize path: strip query params and collapse numeric IDs
    const rawPath = req.route?.path || req.path;
    const normalizedPath = normalizePath(rawPath);

    // Skip health checks and static assets to keep data meaningful
    if (normalizedPath.startsWith("/api/healthz") || normalizedPath.startsWith("/assets")) {
      return;
    }

    records.push({
      path: normalizedPath,
      method: req.method,
      statusCode: res.statusCode,
      durationMs,
      timestamp: Date.now(),
    });

    // Periodic prune to cap memory
    if (records.length > MAX_RECORDS) {
      pruneOldRecords();
      // If still too large after pruning, drop oldest quarter
      if (records.length > MAX_RECORDS) {
        records = records.slice(Math.floor(records.length / 4));
      }
    }
  });

  next();
}

// ── Snapshot generation ──────────────────────────────────────────────────

/**
 * Compute a performance snapshot from the current rolling window.
 */
export function getPerformanceSnapshot(): PerformanceSnapshot {
  pruneOldRecords();

  const now = Date.now();
  const total = records.length;

  if (total === 0) {
    return {
      windowMinutes: 60,
      totalRequests: 0,
      requestsPerMinute: 0,
      statusCodeDistribution: {},
      avgDurationMs: 0,
      p95DurationMs: 0,
      p99DurationMs: 0,
      slowestEndpoints: [],
      generatedAt: new Date().toISOString(),
    };
  }

  // Status code distribution
  const statusCodes: Record<string, number> = {};
  const allDurations: number[] = [];

  // Group by endpoint key (method + path)
  const endpointMap = new Map<string, number[]>();

  for (const r of records) {
    const bucket = `${Math.floor(r.statusCode / 100)}xx`;
    statusCodes[bucket] = (statusCodes[bucket] || 0) + 1;
    allDurations.push(r.durationMs);

    const key = `${r.method} ${r.path}`;
    const durations = endpointMap.get(key);
    if (durations) {
      durations.push(r.durationMs);
    } else {
      endpointMap.set(key, [r.durationMs]);
    }
  }

  allDurations.sort((a, b) => a - b);

  // Actual window span in minutes
  const windowSpanMs = now - records[0].timestamp;
  const windowMinutes = Math.max(windowSpanMs / 60_000, 1);

  // Top 10 slowest endpoints by p95
  const endpointStats: EndpointStats[] = [];
  for (const [key, durations] of endpointMap.entries()) {
    durations.sort((a, b) => a - b);
    const [method, path] = key.split(" ", 2);
    endpointStats.push({
      path,
      method,
      count: durations.length,
      avgMs: round(avg(durations)),
      p95Ms: percentile(durations, 95),
      p99Ms: percentile(durations, 99),
      minMs: durations[0],
      maxMs: durations[durations.length - 1],
    });
  }

  endpointStats.sort((a, b) => b.p95Ms - a.p95Ms);

  return {
    windowMinutes: Math.round(windowMinutes),
    totalRequests: total,
    requestsPerMinute: round(total / windowMinutes),
    statusCodeDistribution: statusCodes,
    avgDurationMs: round(avg(allDurations)),
    p95DurationMs: percentile(allDurations, 95),
    p99DurationMs: percentile(allDurations, 99),
    slowestEndpoints: endpointStats.slice(0, 15),
    generatedAt: new Date().toISOString(),
  };
}

// ── Route registration ───────────────────────────────────────────────────

/**
 * Register the GET /api/metrics/performance endpoint.
 */
export function registerPerformanceMetricsRoute(app: Express): void {
  const { authMiddleware, requireRole } = require("../auth");
  app.get(
    "/api/metrics/performance",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN"),
    (_req: Request, res: Response) => {
      try {
        const snapshot = getPerformanceSnapshot();
        res.json(snapshot);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizePath(path: string): string {
  // Collapse numeric path segments into :id for aggregation
  return path.replace(/\/\d+/g, "/:id").replace(/\?.*$/, "");
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function round(n: number, decimals = 1): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
