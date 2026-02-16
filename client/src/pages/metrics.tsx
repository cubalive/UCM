import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { isDriverHost } from "@/lib/hostDetection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadFile, buildTimestamp } from "@/lib/export";
import {
  Activity,
  Wifi,
  WifiOff,
  Database as DatabaseIcon,
  Shield,
  Zap,
  Clock,
  AlertTriangle,
  RefreshCw,
  MapPin,
  Radio,
  Server,
  BarChart3,
  Download,
  FileSpreadsheet,
  Users,
  Car,
  Building2,
  CheckCircle2,
  Cog,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface MetricsData {
  ok: boolean;
  ts: string;
  request: {
    total_requests_5min: number;
    total_errors_5min: number;
    error_rate_pct: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
  };
  redis: {
    redis_connected: boolean;
    redis_get_count: number;
    redis_set_count: number;
    cache_hit_rate: number;
    cache_hits: number;
    cache_misses: number;
    cache_errors: number;
    gps_rate_limited_count: number;
    eta_lock_contention_count: number;
    cache_by_key: Record<string, { hits: number; misses: number }>;
    last_error: string | null;
  };
  realtime: {
    realtime_tokens_issued_total: number;
    realtime_tokens_per_min: number;
    realtime_broadcasts_total: number;
    realtime_broadcasts_per_min: number;
    realtime_broadcast_errors: number;
    realtime_broadcasts_by_type: Record<string, number>;
    ws_connections: number;
    ws_subscriptions: number;
  };
  google: GoogleMetrics;
  backpressure: {
    total_requests: number;
    rejected_requests: number;
    shed_pct: number;
    avg_queue_depth: number;
    p95_latency_ms: number;
    degrade_mode_on: boolean;
    degrade_tier: number;
    degrade_mode_reason: string | null;
    publish_interval_ms: number;
    publish_dropped_by_throttle: number;
    publish_dropped_location: number;
    publish_dropped_eta: number;
  };
  gps_ingest: {
    gps_ingest_requests_per_min: number;
    gps_ingest_rejected_rate_limit: number;
    gps_ingest_rejected_validation: number;
    db_location_writes_per_min: number;
    totals: {
      requests: number;
      accepted: number;
      rejected_rate_limit: number;
      rejected_validation: number;
      db_writes: number;
      uptime_minutes: number;
    };
  };
}

interface GoogleMetrics {
  ok?: boolean;
  directions_calls_per_min: number;
  directions_calls_last_60s: number;
  directions_failures_last_60s: number;
  directions_failures_total: number;
  eta_calls_total: number;
  eta_cache_hits: number;
  build_route_calls_total: number;
  build_route_cache_hits: number;
  recompute_requests_total: number;
  recompute_blocked_by_throttle: number;
  tracking_requests_total: number;
  tracking_requests_per_min: number;
  circuit_breaker: {
    open: boolean;
    threshold_per_min: number;
    cooldown_seconds: number;
    trips_total: number;
    open_until: string | null;
  };
  uptime_minutes: number;
}

interface HealthData {
  overall: "green" | "yellow" | "red";
  cityId: number;
  cityName: string;
  date: string;
  alerts: Array<{
    code: string;
    severity: "critical" | "warning" | "info";
    title: string;
    count: number;
  }>;
  redis?: string;
  redis_latency_ms?: number;
}

interface AdminSummary {
  ok: boolean;
  ts: string;
  env: string;
  version?: string;
  uptimeSec: number;
  requests: { rpm: number; p50ms: number; p95ms: number; errors5xx: number; errors4xx: number };
  db: { ok: boolean; latencyMs: number };
  ws: { ok: boolean; clients: number; subscriptions: number };
  jobs: {
    eta: { ok: boolean; lastTickAt: string | null; lastError: string | null; tickCount: number };
    autoAssign: { ok: boolean; lastTickAt: string | null; lastError: string | null; tickCount: number };
  };
  counts: { tripsToday: number; tripsInProgress: number; driversOnline: number; activeClinics: number };
}

interface AdminCounts {
  ok: boolean;
  ts: string;
  date: string;
  tripsToday: number;
  tripsInProgress: number;
  tripsCompleted: number;
  tripsCancelled: number;
  tripsScheduled: number;
  driversOnline: number;
  totalDrivers: number;
  activeClinics: number;
  totalClinics: number;
}

interface HistoryPoint {
  time: string;
  p95: number;
  p50: number;
  errorRate: number;
  reqPerMin: number;
}

interface GoogleHistoryPoint {
  time: string;
  calls: number;
  failures: number;
}

const MAX_HISTORY = 20;

function formatTime(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function HealthBadge({ status }: { status: string }) {
  const variant = status === "green" ? "default" : status === "yellow" ? "secondary" : "destructive";
  const label = status.toUpperCase();
  return (
    <Badge variant={variant} data-testid="badge-health-status">
      {label}
    </Badge>
  );
}

function MetricCard({ title, value, subtitle, icon: Icon, className }: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: typeof Activity;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-muted flex-shrink-0">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground truncate">{title}</p>
            <p className="text-lg font-semibold tabular-nums" data-testid={`text-metric-${title.toLowerCase().replace(/\s+/g, '-')}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-14 w-full" /></CardContent></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-48 w-full" /></CardContent></Card>
        ))}
      </div>
    </div>
  );
}

export default function MetricsPage() {
  const { user, selectedCity } = useAuth();
  const [latencyHistory, setLatencyHistory] = useState<HistoryPoint[]>([]);
  const [googleHistory, setGoogleHistory] = useState<GoogleHistoryPoint[]>([]);
  const prevMetricsRef = useRef<string>("");
  const prevGoogleRef = useRef<string>("");

  const token = localStorage.getItem("auth_token") || "";

  const { data: metrics, isLoading: metricsLoading, error: metricsError, refetch: refetchMetrics } = useQuery<MetricsData>({
    queryKey: ["/api/ops/metrics"],
    refetchInterval: 15_000,
    retry: 2,
    enabled: !isDriverHost && !!user && user.role === "SUPER_ADMIN",
  });

  const { data: googleData, isLoading: googleLoading } = useQuery<GoogleMetrics>({
    queryKey: ["/api/ops/metrics/google"],
    refetchInterval: 30_000,
    retry: 2,
    enabled: !isDriverHost && !!user && user.role === "SUPER_ADMIN",
  });

  const { data: healthData, isLoading: healthLoading } = useQuery<HealthData>({
    queryKey: ["/api/ops/health", selectedCity?.id],
    enabled: !isDriverHost && !!user && !!selectedCity?.id && ["SUPER_ADMIN", "ADMIN", "DISPATCH"].includes(user.role),
    refetchInterval: 15_000,
    retry: 2,
    meta: { queryParams: `?city_id=${selectedCity?.id || 1}` },
    queryFn: async () => {
      const res = await fetch(`/api/ops/health?city_id=${selectedCity?.id || 1}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch health");
      return res.json();
    },
  });

  const { data: routesData } = useQuery<{ ok: boolean; routes: Array<{ route: string; request_count: number; error_count: number; p50_ms: number; p95_ms: number }> }>({
    queryKey: ["/api/ops/metrics/routes"],
    refetchInterval: 30_000,
    retry: 1,
    enabled: !isDriverHost && !!user && user.role === "SUPER_ADMIN",
  });

  const { data: adminSummary, refetch: refetchAdmin } = useQuery<AdminSummary>({
    queryKey: ["/api/admin/metrics/summary"],
    refetchInterval: 10_000,
    retry: 2,
    enabled: !isDriverHost && !!user && user.role === "SUPER_ADMIN",
  });

  const { data: adminCounts } = useQuery<AdminCounts>({
    queryKey: ["/api/admin/metrics/counts"],
    refetchInterval: 15_000,
    retry: 2,
    enabled: !isDriverHost && !!user && user.role === "SUPER_ADMIN",
  });

  const { toast } = useToast();

  const hasRoutes = !!(routesData?.routes && routesData.routes.length > 0);

  function exportJson() {
    if (!metrics && !adminSummary) { toast({ title: "Metrics not loaded yet. Try again in a few seconds.", variant: "destructive" }); return; }
    const ts = buildTimestamp();
    const payload = {
      generatedAt: new Date().toISOString(),
      adminSummary: adminSummary ?? null,
      adminCounts: adminCounts ?? null,
      health: healthData ?? null,
      metrics: metrics ?? null,
      google: googleData ?? metrics?.google ?? null,
      routes: routesData?.routes ?? null,
    };
    const filename = `ucm-metrics-${ts}.json`;
    downloadFile(JSON.stringify(payload, null, 2), filename, "application/json");
    toast({ title: `Downloaded ${filename}` });
  }

  function exportSummaryCsv() {
    if (!metrics) { toast({ title: "Metrics not loaded yet. Try again in a few seconds.", variant: "destructive" }); return; }
    const ts = buildTimestamp();
    const goog = googleData || metrics.google;
    const row: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      healthStatus: healthData?.overall ?? "",
      reqPerMin: metrics.request.total_requests_5min,
      errorRatePct: metrics.request.error_rate_pct,
      p95LatencyMs: metrics.request.p95_latency_ms,
      redisOk: metrics.redis.redis_connected ? "yes" : "no",
      cacheHitRatePct: metrics.redis.cache_hit_rate,
      realtimeTokensIssuedPerMin: metrics.realtime.realtime_tokens_per_min,
      realtimePublishesPerMin_location: metrics.realtime.realtime_broadcasts_by_type?.location ?? 0,
      realtimePublishesPerMin_eta: metrics.realtime.realtime_broadcasts_by_type?.eta ?? 0,
      realtimePublishesPerMin_status: metrics.realtime.realtime_broadcasts_by_type?.status_change ?? 0,
      directionsCallsPerMin: goog?.directions_calls_per_min ?? 0,
      directionsFailuresPerMin: goog?.directions_failures_last_60s ?? 0,
      breakerOn: goog?.circuit_breaker?.open ? "yes" : "no",
    };
    const filename = `ucm-metrics-summary-${ts}.csv`;
    downloadFile(toCsv([row]), filename, "text/csv");
    toast({ title: `Downloaded ${filename}` });
  }

  function exportHealthCsv() {
    if (!healthData) { toast({ title: "Health data not loaded yet. Try again in a few seconds.", variant: "destructive" }); return; }
    const ts = buildTimestamp();
    const row: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      overall: healthData.overall?.toUpperCase() ?? "",
      redis: healthData.redis ?? (metrics?.redis.redis_connected ? "ok" : "fail"),
      redisLatencyMs: healthData.redis_latency_ms ?? "",
      lastError: metrics?.redis.last_error ?? "",
    };
    const filename = `ucm-metrics-health-${ts}.csv`;
    downloadFile(toCsv([row]), filename, "text/csv");
    toast({ title: `Downloaded ${filename}` });
  }

  function exportCacheCsv() {
    if (!metrics) { toast({ title: "Metrics not loaded yet. Try again in a few seconds.", variant: "destructive" }); return; }
    const ts = buildTimestamp();
    const cacheByKey = metrics.redis.cache_by_key;
    const rows: Record<string, unknown>[] = [];
    if (cacheByKey && Object.keys(cacheByKey).length > 0) {
      for (const [keyFamily, data] of Object.entries(cacheByKey)) {
        const total = data.hits + data.misses;
        rows.push({
          generatedAt: new Date().toISOString(),
          keyFamily,
          hits: data.hits,
          misses: data.misses,
          hitRatePct: total > 0 ? Math.round((data.hits / total) * 100) : 0,
        });
      }
    } else {
      const total = metrics.redis.cache_hits + metrics.redis.cache_misses;
      rows.push({
        generatedAt: new Date().toISOString(),
        keyFamily: "all",
        hits: metrics.redis.cache_hits,
        misses: metrics.redis.cache_misses,
        hitRatePct: total > 0 ? Math.round((metrics.redis.cache_hits / total) * 100) : 0,
      });
    }
    const filename = `ucm-metrics-cache-${ts}.csv`;
    downloadFile(toCsv(rows, ["generatedAt", "keyFamily", "hits", "misses", "hitRatePct"]), filename, "text/csv");
    toast({ title: `Downloaded ${filename}` });
  }

  function exportRealtimeCsv() {
    if (!metrics) { toast({ title: "Metrics not loaded yet. Try again in a few seconds.", variant: "destructive" }); return; }
    const ts = buildTimestamp();
    const now = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    const byType = metrics.realtime.realtime_broadcasts_by_type;
    if (byType) {
      for (const [eventType, count] of Object.entries(byType)) {
        rows.push({ generatedAt: now, eventType, publishesPerMin: count });
      }
    }
    rows.push({
      generatedAt: now,
      eventType: "__totals__",
      publishesPerMin: metrics.realtime.realtime_broadcasts_per_min,
      tokensIssuedPerMin: metrics.realtime.realtime_tokens_per_min,
      wsConnections: metrics.realtime.ws_connections,
    });
    const filename = `ucm-metrics-realtime-${ts}.csv`;
    downloadFile(toCsv(rows, ["generatedAt", "eventType", "publishesPerMin", "tokensIssuedPerMin", "wsConnections"]), filename, "text/csv");
    toast({ title: `Downloaded ${filename}` });
  }

  function exportGoogleCsv() {
    const goog = googleData || metrics?.google;
    if (!goog) { toast({ title: "Google metrics not loaded yet. Try again in a few seconds.", variant: "destructive" }); return; }
    const ts = buildTimestamp();
    const row: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      directionsCallsPerMin: goog.directions_calls_per_min,
      directionsFailuresPerMin: goog.directions_failures_last_60s,
      breakerOn: goog.circuit_breaker?.open ? "yes" : "no",
      breakerRemainingSec: goog.circuit_breaker?.cooldown_seconds ?? "",
      lockContentionCount: metrics?.redis.eta_lock_contention_count ?? "",
    };
    const filename = `ucm-metrics-google-${ts}.csv`;
    downloadFile(toCsv([row]), filename, "text/csv");
    toast({ title: `Downloaded ${filename}` });
  }

  function exportRoutesCsv() {
    if (!routesData?.routes?.length) { toast({ title: "Routes metrics not available.", variant: "destructive" }); return; }
    const ts = buildTimestamp();
    const now = new Date().toISOString();
    const rows = routesData.routes.map((r) => ({
      generatedAt: now,
      route: r.route,
      count: r.request_count,
      p95Ms: r.p95_ms,
      errorCount: r.error_count,
    }));
    const filename = `ucm-metrics-routes-${ts}.csv`;
    downloadFile(toCsv(rows, ["generatedAt", "route", "count", "p95Ms", "errorCount"]), filename, "text/csv");
    toast({ title: `Downloaded ${filename}` });
  }

  useEffect(() => {
    if (!metrics) return;
    const fingerprint = `${metrics.request.p95_latency_ms}-${metrics.request.error_rate_pct}-${metrics.ts}`;
    if (fingerprint === prevMetricsRef.current) return;
    prevMetricsRef.current = fingerprint;

    const time = formatTime(metrics.ts);
    const elapsed = (metrics.gps_ingest?.totals?.uptime_minutes || 1);
    const reqPerMin = elapsed > 0
      ? Math.round(metrics.request.total_requests_5min / Math.min(5, elapsed))
      : metrics.request.total_requests_5min;

    setLatencyHistory((prev) => {
      const next = [...prev, {
        time,
        p95: metrics.request.p95_latency_ms,
        p50: metrics.request.p50_latency_ms,
        errorRate: metrics.request.error_rate_pct,
        reqPerMin,
      }];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
  }, [metrics]);

  useEffect(() => {
    if (!googleData) return;
    const gd = googleData;
    const fingerprint = `${gd.directions_calls_last_60s}-${gd.directions_failures_last_60s}`;
    if (fingerprint === prevGoogleRef.current) return;
    prevGoogleRef.current = fingerprint;

    const time = formatTime(new Date().toISOString());
    setGoogleHistory((prev) => {
      const next = [...prev, {
        time,
        calls: gd.directions_calls_last_60s,
        failures: gd.directions_failures_last_60s,
      }];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
  }, [googleData]);

  if (metricsLoading && !metrics) return <LoadingSkeleton />;

  if (metricsError) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="metrics-error">
        <Card className="w-full max-w-sm mx-4">
          <CardContent className="p-6 text-center space-y-3">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">Failed to load metrics</p>
            <Button onClick={() => refetchMetrics()} data-testid="button-retry-metrics">
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const req = metrics?.request;
  const redis = metrics?.redis;
  const rt = metrics?.realtime;
  const bp = metrics?.backpressure;
  const gps = metrics?.gps_ingest;
  const goog = googleData || metrics?.google;
  const health = healthData;

  const cacheData = redis ? [
    { name: "Hits", value: redis.cache_hits },
    { name: "Misses", value: redis.cache_misses },
  ] : [];

  const broadcastTypes = rt?.realtime_broadcasts_by_type
    ? Object.entries(rt.realtime_broadcasts_by_type).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="space-y-4 p-4 md:p-6" data-testid="metrics-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-metrics-title">System Metrics</h1>
          {metrics?.ts && (
            <p className="text-xs text-muted-foreground">
              Last updated: {formatTime(metrics.ts)}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => { refetchMetrics(); refetchAdmin(); }} data-testid="button-refresh-metrics">
          <RefreshCw className="mr-2 h-3 w-3" />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!metrics} onClick={exportJson} data-testid="button-download-json">
          <Download className="mr-2 h-3 w-3" />
          Download JSON
        </Button>
        <Button size="sm" variant="outline" disabled={!metrics} onClick={exportSummaryCsv} data-testid="button-csv-summary">
          <FileSpreadsheet className="mr-2 h-3 w-3" />
          CSV: Summary
        </Button>
        <Button size="sm" variant="outline" disabled={!healthData} onClick={exportHealthCsv} data-testid="button-csv-health">
          <FileSpreadsheet className="mr-2 h-3 w-3" />
          CSV: Health
        </Button>
        <Button size="sm" variant="outline" disabled={!metrics} onClick={exportCacheCsv} data-testid="button-csv-cache">
          <FileSpreadsheet className="mr-2 h-3 w-3" />
          CSV: Redis/Cache
        </Button>
        <Button size="sm" variant="outline" disabled={!metrics} onClick={exportRealtimeCsv} data-testid="button-csv-realtime">
          <FileSpreadsheet className="mr-2 h-3 w-3" />
          CSV: Realtime
        </Button>
        <Button size="sm" variant="outline" disabled={!metrics && !googleData} onClick={exportGoogleCsv} data-testid="button-csv-google">
          <FileSpreadsheet className="mr-2 h-3 w-3" />
          CSV: Google
        </Button>
        <UiTooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="sm" variant="outline" disabled={!hasRoutes} onClick={exportRoutesCsv} data-testid="button-csv-routes">
                <FileSpreadsheet className="mr-2 h-3 w-3" />
                CSV: Routes
              </Button>
            </span>
          </TooltipTrigger>
          {!hasRoutes && (
            <TooltipContent>Routes metrics not available</TooltipContent>
          )}
        </UiTooltip>
      </div>

      {/* Status Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card data-testid="card-health">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-muted flex-shrink-0">
                <Activity className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Health</p>
                {healthLoading ? (
                  <Skeleton className="h-5 w-16 mt-1" />
                ) : health ? (
                  <HealthBadge status={health.overall} />
                ) : (
                  <Badge variant="secondary">N/A</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <MetricCard
          title="p95 Latency"
          value={req ? `${req.p95_latency_ms}ms` : "---"}
          subtitle={req ? `p50: ${req.p50_latency_ms}ms` : undefined}
          icon={Clock}
        />

        <MetricCard
          title="Error Rate"
          value={req ? `${req.error_rate_pct}%` : "---"}
          subtitle={req ? `${req.total_errors_5min} errors / 5min` : undefined}
          icon={AlertTriangle}
        />

        <MetricCard
          title="Requests / 5min"
          value={req?.total_requests_5min ?? "---"}
          icon={BarChart3}
        />
      </div>

      {adminSummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Card data-testid="card-api-status">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted flex-shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">API</p>
                  <Badge variant={adminSummary.ok ? "default" : "destructive"}>
                    {adminSummary.ok ? "OK" : "ERROR"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-db-status">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted flex-shrink-0">
                  <DatabaseIcon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Database</p>
                  <Badge variant={adminSummary.db.ok ? "default" : "destructive"}>
                    {adminSummary.db.ok ? "OK" : "DOWN"}
                  </Badge>
                  <p className="text-xs text-muted-foreground tabular-nums mt-0.5" data-testid="text-db-latency">{adminSummary.db.latencyMs}ms</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-ws-status">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted flex-shrink-0">
                  <Wifi className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">WebSocket</p>
                  <Badge variant={adminSummary.ws.ok ? "default" : "destructive"}>
                    {adminSummary.ws.ok ? "OK" : "DOWN"}
                  </Badge>
                  <p className="text-xs text-muted-foreground tabular-nums mt-0.5" data-testid="text-ws-clients">{adminSummary.ws.clients} clients</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-eta-job">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted flex-shrink-0">
                  <Cog className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">ETA Engine</p>
                  <Badge variant={adminSummary.jobs.eta.ok ? "default" : "destructive"}>
                    {adminSummary.jobs.eta.ok ? "RUNNING" : "STOPPED"}
                  </Badge>
                  {adminSummary.jobs.eta.lastTickAt && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid="text-eta-tick">
                      {formatTime(adminSummary.jobs.eta.lastTickAt)}
                    </p>
                  )}
                  {adminSummary.jobs.eta.lastError && (
                    <p className="text-xs text-destructive truncate mt-0.5">{adminSummary.jobs.eta.lastError}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-autoassign-job">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted flex-shrink-0">
                  <Car className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Auto-Assign</p>
                  <Badge variant={adminSummary.jobs.autoAssign.ok ? "default" : "destructive"}>
                    {adminSummary.jobs.autoAssign.ok ? "RUNNING" : "STOPPED"}
                  </Badge>
                  {adminSummary.jobs.autoAssign.lastTickAt && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid="text-assign-tick">
                      {formatTime(adminSummary.jobs.autoAssign.lastTickAt)}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <MetricCard
            title="RPM"
            value={adminSummary.requests.rpm}
            subtitle={`5xx: ${adminSummary.requests.errors5xx} / 4xx: ${adminSummary.requests.errors4xx}`}
            icon={BarChart3}
          />

          <Card data-testid="card-uptime">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted flex-shrink-0">
                  <Server className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Uptime</p>
                  <p className="text-lg font-semibold tabular-nums" data-testid="text-uptime">
                    {adminSummary.uptimeSec >= 3600
                      ? `${Math.floor(adminSummary.uptimeSec / 3600)}h ${Math.floor((adminSummary.uptimeSec % 3600) / 60)}m`
                      : `${Math.floor(adminSummary.uptimeSec / 60)}m`}
                  </p>
                  <p className="text-xs text-muted-foreground">{adminSummary.env} v{adminSummary.version}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {adminCounts && (
        <Card data-testid="card-counts">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              Today's Counts ({adminCounts.date})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Trips Today</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-trips-today">{adminCounts.tripsToday}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">In Progress</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-trips-progress">{adminCounts.tripsInProgress}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Completed</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-trips-completed">{adminCounts.tripsCompleted}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Drivers Online</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-drivers-online">{adminCounts.driversOnline} / {adminCounts.totalDrivers}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active Clinics</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-active-clinics">{adminCounts.activeClinics} / {adminCounts.totalClinics}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Scheduled</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-trips-scheduled">{adminCounts.tripsScheduled}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {routesData?.routes && routesData.routes.length > 0 && (
        <Card data-testid="card-routes-table">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              Request Routes (5min window)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Route</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Count</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Errors</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">p50</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">p95</th>
                  </tr>
                </thead>
                <tbody>
                  {routesData.routes.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5 px-2 font-mono text-foreground" data-testid={`text-route-${i}`}>{r.route}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums">{r.request_count}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums">{r.error_count}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums">{r.p50_ms}ms</td>
                      <td className="text-right py-1.5 px-2 tabular-nums">{r.p95_ms}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts + Detail Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Latency Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              Latency Over Time
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            {latencyHistory.length < 2 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                Collecting data...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={latencyHistory}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="p95" stroke="hsl(var(--destructive))" name="p95 (ms)" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="p50" stroke="hsl(var(--primary))" name="p50 (ms)" dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Redis / Cache */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DatabaseIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              Cache / Redis
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {redis?.redis_connected ? (
                <Badge variant="default" data-testid="badge-redis-status">
                  <Wifi className="mr-1 h-3 w-3" /> Connected
                </Badge>
              ) : (
                <Badge variant="destructive" data-testid="badge-redis-status">
                  <WifiOff className="mr-1 h-3 w-3" /> Disconnected
                </Badge>
              )}
              <span className="text-sm tabular-nums" data-testid="text-cache-hit-rate">
                Hit Rate: <strong>{redis?.cache_hit_rate ?? 0}%</strong>
              </span>
            </div>

            {cacheData.length > 0 && (
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={cacheData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>GET ops: <strong className="text-foreground">{redis?.redis_get_count ?? 0}</strong></span>
              <span>SET ops: <strong className="text-foreground">{redis?.redis_set_count ?? 0}</strong></span>
              <span>Errors: <strong className="text-foreground">{redis?.cache_errors ?? 0}</strong></span>
              <span>Lock Contention: <strong className="text-foreground">{redis?.eta_lock_contention_count ?? 0}</strong></span>
            </div>
          </CardContent>
        </Card>

        {/* Realtime */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              Realtime
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Tokens / min</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-tokens-per-min">{rt?.realtime_tokens_per_min ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Broadcasts / min</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-broadcasts-per-min">{rt?.realtime_broadcasts_per_min ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">WS Connections</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-ws-connections">{rt?.ws_connections ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Subscriptions</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-ws-subscriptions">{rt?.ws_subscriptions ?? 0}</p>
              </div>
            </div>

            {broadcastTypes.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Broadcasts by Type</p>
                <div className="flex flex-wrap gap-2">
                  {broadcastTypes.map((bt) => (
                    <Badge key={bt.name} variant="secondary">
                      {bt.name}: {bt.value}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {rt?.realtime_broadcast_errors ? (
              <p className="text-xs text-destructive">Broadcast Errors: {rt.realtime_broadcast_errors}</p>
            ) : null}
          </CardContent>
        </Card>

        {/* Google Directions Guard */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              Google Directions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            {goog && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  {goog.circuit_breaker?.open ? (
                    <Badge variant="destructive" data-testid="badge-circuit-breaker">
                      <Shield className="mr-1 h-3 w-3" /> Breaker OPEN
                    </Badge>
                  ) : (
                    <Badge variant="default" data-testid="badge-circuit-breaker">
                      <Shield className="mr-1 h-3 w-3" /> Breaker OK
                    </Badge>
                  )}
                  {goog.circuit_breaker?.open && goog.circuit_breaker?.open_until && (
                    <span className="text-xs text-muted-foreground">
                      Until: {formatTime(goog.circuit_breaker.open_until)}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>Calls/min: <strong className="text-foreground tabular-nums">{goog.directions_calls_per_min}</strong></span>
                  <span>Last 60s: <strong className="text-foreground tabular-nums">{goog.directions_calls_last_60s}</strong></span>
                  <span>Failures (60s): <strong className="text-foreground tabular-nums">{goog.directions_failures_last_60s}</strong></span>
                  <span>Failures (total): <strong className="text-foreground tabular-nums">{goog.directions_failures_total}</strong></span>
                  <span>ETA Calls: <strong className="text-foreground tabular-nums">{goog.eta_calls_total}</strong></span>
                  <span>ETA Cache Hits: <strong className="text-foreground tabular-nums">{goog.eta_cache_hits}</strong></span>
                  <span>Threshold: <strong className="text-foreground tabular-nums">{goog.circuit_breaker?.threshold_per_min}/min</strong></span>
                  <span>Breaker Trips: <strong className="text-foreground tabular-nums">{goog.circuit_breaker?.trips_total}</strong></span>
                </div>

                {googleHistory.length >= 2 && (
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={googleHistory}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="calls" stroke="hsl(var(--primary))" name="Calls (60s)" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="failures" stroke="hsl(var(--destructive))" name="Failures (60s)" dot={false} strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </>
            )}
            {googleLoading && !goog && <Skeleton className="h-32 w-full" />}
          </CardContent>
        </Card>

        {/* GPS Ingest */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              GPS Ingest
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Requests / min</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-gps-req-min">{gps?.gps_ingest_requests_per_min ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">DB Writes / min</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-gps-writes-min">{gps?.db_location_writes_per_min ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Rate Limited</p>
                <p className="text-sm font-semibold tabular-nums">{gps?.gps_ingest_rejected_rate_limit ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Validation Errors</p>
                <p className="text-sm font-semibold tabular-nums">{gps?.gps_ingest_rejected_validation ?? 0}</p>
              </div>
            </div>
            {gps?.totals && (
              <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                Uptime: {gps.totals.uptime_minutes} min | Total: {gps.totals.requests} req, {gps.totals.db_writes} writes
              </div>
            )}
          </CardContent>
        </Card>

        {/* Backpressure / Adaptive Publish */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              Backpressure / Adaptive Publish
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {bp?.degrade_mode_on ? (
                <Badge variant="destructive" data-testid="badge-degrade-mode">
                  Tier {bp.degrade_tier} Degraded
                </Badge>
              ) : (
                <Badge variant="default" data-testid="badge-degrade-mode">
                  Normal
                </Badge>
              )}
              <span className="text-xs text-muted-foreground tabular-nums" data-testid="text-publish-interval">
                Publish interval: <strong className="text-foreground">{bp?.publish_interval_ms ?? 5000}ms</strong>
              </span>
            </div>
            {bp?.degrade_mode_reason && (
              <p className="text-xs text-destructive" data-testid="text-degrade-reason">{bp.degrade_mode_reason}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">p95 Latency</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-bp-p95">{bp?.p95_latency_ms ?? 0}ms</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dropped (throttle)</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-bp-dropped">{bp?.publish_dropped_by_throttle ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dropped Location</p>
                <p className="text-sm font-semibold tabular-nums">{bp?.publish_dropped_location ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dropped ETA</p>
                <p className="text-sm font-semibold tabular-nums">{bp?.publish_dropped_eta ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Health Alerts */}
        {health && health.alerts.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                Active Alerts ({health.cityName})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="space-y-2">
                {health.alerts.map((alert, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Badge
                      variant={alert.severity === "critical" ? "destructive" : alert.severity === "warning" ? "secondary" : "default"}
                    >
                      {alert.severity}
                    </Badge>
                    <span className="text-foreground" data-testid={`text-alert-${i}`}>{alert.title}</span>
                    {alert.count > 1 && (
                      <span className="text-muted-foreground text-xs">({alert.count})</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
