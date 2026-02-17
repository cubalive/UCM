import type { Request, Response, NextFunction } from "express";

const PROFILE_ENABLED = process.env.UCM_PROFILE === "true";
const QUERY_BUDGET_WARN = 15;

export interface RequestTrace {
  requestId: string;
  route: string;
  method: string;
  userId?: number;
  role?: string;
  companyId?: number | null;
  startMs: number;
  dbMs: number;
  dbQueryCount: number;
  cacheHits: number;
  cacheMisses: number;
  externalApiMs: number;
  externalApiCalls: number;
  wsBroadcastMs: number;
}

const activeTraces = new Map<string, RequestTrace>();
const ROLLING_WINDOW_MS = 5 * 60 * 1000;

interface RoutePerf {
  route: string;
  timestamps: number[];
  totalMs: number[];
  dbMs: number[];
  externalMs: number[];
  cacheHits: number;
  cacheMisses: number;
  queryCountWarnings: number;
}

const routePerfMap = new Map<string, RoutePerf>();

function normalizeRoute(path: string): string {
  return path
    .replace(/\/\d+/g, "/:id")
    .replace(/\/[0-9a-f]{8,}/g, "/:id")
    .replace(/\?.*$/, "");
}

function prunePerf(rp: RoutePerf): void {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  while (rp.timestamps.length > 0 && rp.timestamps[0] < cutoff) {
    rp.timestamps.shift();
    rp.totalMs.shift();
    rp.dbMs.shift();
    rp.externalMs.shift();
  }
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

let requestIdCounter = 0;

export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${(++requestIdCounter).toString(36)}`;
}

export function startTrace(reqId: string, method: string, path: string): RequestTrace {
  const trace: RequestTrace = {
    requestId: reqId,
    route: normalizeRoute(path),
    method,
    startMs: Date.now(),
    dbMs: 0,
    dbQueryCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    externalApiMs: 0,
    externalApiCalls: 0,
    wsBroadcastMs: 0,
  };
  activeTraces.set(reqId, trace);
  return trace;
}

export function getTrace(reqId: string): RequestTrace | undefined {
  return activeTraces.get(reqId);
}

export function recordDbTime(reqId: string, ms: number): void {
  const trace = activeTraces.get(reqId);
  if (trace) {
    trace.dbMs += ms;
    trace.dbQueryCount++;
  }
}

export function recordCacheHit(reqId: string): void {
  const trace = activeTraces.get(reqId);
  if (trace) trace.cacheHits++;
}

export function recordCacheMiss(reqId: string): void {
  const trace = activeTraces.get(reqId);
  if (trace) trace.cacheMisses++;
}

export function recordExternalApiTime(reqId: string, ms: number): void {
  const trace = activeTraces.get(reqId);
  if (trace) {
    trace.externalApiMs += ms;
    trace.externalApiCalls++;
  }
}

export function recordWsBroadcastTime(reqId: string, ms: number): void {
  const trace = activeTraces.get(reqId);
  if (trace) trace.wsBroadcastMs += ms;
}

export function finishTrace(reqId: string): RequestTrace | undefined {
  const trace = activeTraces.get(reqId);
  if (!trace) return undefined;
  activeTraces.delete(trace.requestId);

  const totalMs = Date.now() - trace.startMs;
  const routeKey = `${trace.method} ${trace.route}`;
  const now = Date.now();

  let rp = routePerfMap.get(routeKey);
  if (!rp) {
    rp = {
      route: routeKey,
      timestamps: [],
      totalMs: [],
      dbMs: [],
      externalMs: [],
      cacheHits: 0,
      cacheMisses: 0,
      queryCountWarnings: 0,
    };
    routePerfMap.set(routeKey, rp);
  }

  prunePerf(rp);
  rp.timestamps.push(now);
  rp.totalMs.push(totalMs);
  rp.dbMs.push(trace.dbMs);
  rp.externalMs.push(trace.externalApiMs);
  rp.cacheHits += trace.cacheHits;
  rp.cacheMisses += trace.cacheMisses;

  if (trace.dbQueryCount > QUERY_BUDGET_WARN) {
    rp.queryCountWarnings++;
    if (PROFILE_ENABLED) {
      console.warn(`[PERF-TRACE] N+1 WARNING: ${routeKey} triggered ${trace.dbQueryCount} queries (budget: ${QUERY_BUDGET_WARN}) requestId=${reqId}`);
    }
  }

  if (PROFILE_ENABLED) {
    console.log(JSON.stringify({
      level: "perf",
      requestId: reqId,
      route: routeKey,
      totalMs,
      dbMs: trace.dbMs,
      dbQueries: trace.dbQueryCount,
      cacheHits: trace.cacheHits,
      cacheMisses: trace.cacheMisses,
      externalApiMs: trace.externalApiMs,
      externalApiCalls: trace.externalApiCalls,
      wsBroadcastMs: trace.wsBroadcastMs,
      userId: trace.userId,
      role: trace.role,
    }));
  }

  return trace;
}

export function getPerfSummary(minutesWindow = 5): {
  window_minutes: number;
  total_requests: number;
  rpm: number;
  p50_ms: number;
  p95_ms: number;
  error_rate_pct: number;
  avg_db_ms: number;
  db_time_share_pct: number;
  cache_hit_rate_pct: number;
  external_api_time_share_pct: number;
  top_slow_routes: Array<{
    route: string;
    count: number;
    p50_ms: number;
    p95_ms: number;
    db_p95_ms: number;
    external_p95_ms: number;
    cache_hit_rate_pct: number;
    query_budget_warnings: number;
  }>;
  query_budget_violations: number;
} {
  const windowMs = minutesWindow * 60_000;
  const cutoff = Date.now() - windowMs;

  let totalReqs = 0;
  let totalMs = 0;
  let totalDbMs = 0;
  let totalExtMs = 0;
  let totalCacheHits = 0;
  let totalCacheMisses = 0;
  let totalBudgetWarnings = 0;
  const allLatencies: number[] = [];

  const routeSummaries: Array<{
    route: string;
    count: number;
    p50_ms: number;
    p95_ms: number;
    db_p95_ms: number;
    external_p95_ms: number;
    cache_hit_rate_pct: number;
    query_budget_warnings: number;
  }> = [];

  routePerfMap.forEach((rp) => {
    prunePerf(rp);
    if (rp.timestamps.length === 0) return;

    const count = rp.timestamps.length;
    totalReqs += count;
    totalMs += rp.totalMs.reduce((a, b) => a + b, 0);
    totalDbMs += rp.dbMs.reduce((a, b) => a + b, 0);
    totalExtMs += rp.externalMs.reduce((a, b) => a + b, 0);
    totalCacheHits += rp.cacheHits;
    totalCacheMisses += rp.cacheMisses;
    totalBudgetWarnings += rp.queryCountWarnings;
    allLatencies.push(...rp.totalMs);

    const cacheTotal = rp.cacheHits + rp.cacheMisses;

    routeSummaries.push({
      route: rp.route,
      count,
      p50_ms: percentile(rp.totalMs, 0.5),
      p95_ms: percentile(rp.totalMs, 0.95),
      db_p95_ms: percentile(rp.dbMs, 0.95),
      external_p95_ms: percentile(rp.externalMs, 0.95),
      cache_hit_rate_pct: cacheTotal > 0 ? Math.round((rp.cacheHits / cacheTotal) * 100) : 0,
      query_budget_warnings: rp.queryCountWarnings,
    });
  });

  routeSummaries.sort((a, b) => b.p95_ms - a.p95_ms);

  const cacheTotal = totalCacheHits + totalCacheMisses;

  return {
    window_minutes: minutesWindow,
    total_requests: totalReqs,
    rpm: minutesWindow > 0 ? Math.round(totalReqs / minutesWindow) : 0,
    p50_ms: percentile(allLatencies, 0.5),
    p95_ms: percentile(allLatencies, 0.95),
    error_rate_pct: 0,
    avg_db_ms: totalReqs > 0 ? Math.round(totalDbMs / totalReqs) : 0,
    db_time_share_pct: totalMs > 0 ? Math.round((totalDbMs / totalMs) * 100) : 0,
    cache_hit_rate_pct: cacheTotal > 0 ? Math.round((totalCacheHits / cacheTotal) * 100) : 0,
    external_api_time_share_pct: totalMs > 0 ? Math.round((totalExtMs / totalMs) * 100) : 0,
    top_slow_routes: routeSummaries.slice(0, 20),
    query_budget_violations: totalBudgetWarnings,
  };
}

export function isProfilingEnabled(): boolean {
  return PROFILE_ENABLED;
}

export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const reqId = (req.headers["x-request-id"] as string) || generateRequestId();
  (req as any)._requestId = reqId;
  res.setHeader("x-request-id", reqId);

  const trace = startTrace(reqId, req.method, req.path);

  const authUser = (req as any).user;
  if (authUser) {
    trace.userId = authUser.userId;
    trace.role = authUser.role;
    trace.companyId = authUser.companyId;
  }

  const origEnd = res.end.bind(res);
  (res as any).end = function (this: any, chunk?: any, encoding?: any, cb?: any) {
    const authUser2 = (req as any).user;
    if (authUser2 && !trace.userId) {
      trace.userId = authUser2.userId;
      trace.role = authUser2.role;
      trace.companyId = authUser2.companyId;
    }
    finishTrace(reqId);
    return origEnd(chunk, encoding, cb);
  };

  next();
}
