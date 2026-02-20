import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { isDriverHost } from "@/lib/hostDetection";
import { apiFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { downloadWithAuth, buildTimestamp } from "@/lib/export";
import { rawAuthFetch } from "@/lib/api";
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
  Loader2,
  Users,
  Car,
  Building2,
  CheckCircle2,
  Cog,
  Brain,
  TrendingUp,
  TrendingDown,
  ListChecks,
  XCircle,
  Cpu,
  HardDrive,
  Gauge,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    rpm_1min: number;
    rpm_5min: number;
    rpm_15min: number;
    errors_4xx_5min: number;
    errors_5xx_5min: number;
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
  const [exportLoading, setExportLoading] = useState<string | null>(null);
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
    enabled: !isDriverHost && !!user && !!selectedCity?.id && ["SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"].includes(user.role),
    refetchInterval: 15_000,
    retry: 2,
    queryFn: () => apiFetch(`/api/ops/health?city_id=${selectedCity?.id || 1}`, token),
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

  interface HealthMetric { state: "HEALTHY" | "GOOD" | "CRITICAL"; reason: string; [key: string]: any }
  interface PlatformHealth {
    ok: boolean;
    overallState: "HEALTHY" | "GOOD" | "CRITICAL";
    timestamp: string;
    db: HealthMetric;
    api: HealthMetric;
    imports: HealthMetric;
    trips: HealthMetric;
    drivers: HealthMetric;
    notifications: HealthMetric;
  }

  const { data: platformHealth, refetch: refetchHealth } = useQuery<PlatformHealth>({
    queryKey: ["/api/admin/metrics/health"],
    refetchInterval: 20_000,
    retry: 2,
    enabled: !isDriverHost && !!user && user.role === "SUPER_ADMIN",
  });

  const { toast } = useToast();

  const showToast = (msg: string) => toast({ title: msg, variant: "destructive" });

  async function doExport(key: string, url: string, filename: string, mime: string) {
    setExportLoading(key);
    try {
      const ok = await downloadWithAuth(url, filename, mime, rawAuthFetch, showToast);
      if (ok) toast({ title: `Downloaded ${filename}` });
    } finally {
      setExportLoading(null);
    }
  }

  const exportJson = () => doExport("json", "/api/ops/metrics/download.json", `ucm-metrics-${buildTimestamp()}.json`, "application/json");
  const exportCsv = () => doExport("csv", "/api/ops/metrics.csv", `ucm-metrics-${buildTimestamp()}.csv`, "text/csv; charset=utf-8");
  const exportSummaryCsv = () => doExport("summary", "/api/ops/metrics/summary.csv", `ucm-metrics-summary-${buildTimestamp()}.csv`, "text/csv; charset=utf-8");
  const exportHealthCsv = () => doExport("health", "/api/ops/metrics/health.csv", `ucm-metrics-health-${buildTimestamp()}.csv`, "text/csv; charset=utf-8");
  const exportCacheCsv = () => doExport("cache", "/api/ops/metrics/cache.csv", `ucm-metrics-cache-${buildTimestamp()}.csv`, "text/csv; charset=utf-8");
  const exportRealtimeCsv = () => doExport("realtime", "/api/ops/metrics/realtime.csv", `ucm-metrics-realtime-${buildTimestamp()}.csv`, "text/csv; charset=utf-8");
  const exportGoogleCsv = () => doExport("google", "/api/ops/metrics/google.csv", `ucm-metrics-google-${buildTimestamp()}.csv`, "text/csv; charset=utf-8");
  const exportRoutesCsv = () => doExport("routes", "/api/ops/metrics/routes.csv", `ucm-metrics-routes-${buildTimestamp()}.csv`, "text/csv; charset=utf-8");

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

  if (!user || user.role !== "SUPER_ADMIN") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="metrics-unauthorized">
        <Card className="w-full max-w-sm mx-4">
          <CardContent className="p-6 text-center space-y-3">
            <Shield className="h-8 w-8 text-destructive mx-auto" />
            <p className="font-semibold">Unauthorized</p>
            <p className="text-sm text-muted-foreground">
              System Metrics is restricted to Super Admin users only.
              Contact your Super Admin for access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (metricsLoading && !metrics) return <LoadingSkeleton />;

  const is403or401 = metricsError instanceof Error &&
    (metricsError.message.startsWith("403") || metricsError.message.startsWith("401"));

  if (is403or401) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="metrics-unauthorized">
        <Card className="w-full max-w-sm mx-4">
          <CardContent className="p-6 text-center space-y-3">
            <Shield className="h-8 w-8 text-destructive mx-auto" />
            <p className="font-semibold">Unauthorized</p>
            <p className="text-sm text-muted-foreground">
              You do not have permission to view System Metrics.
              Contact your Super Admin for access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (metricsError) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="metrics-error">
        <Card className="w-full max-w-sm mx-4">
          <CardContent className="p-6 text-center space-y-3">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
            <p className="font-semibold">Failed to load metrics</p>
            <p className="text-sm text-muted-foreground">
              {metricsError instanceof Error ? metricsError.message : "An unexpected error occurred."}
            </p>
            <Button onClick={() => refetchMetrics()} data-testid="button-retry-metrics">
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!metrics && !metricsLoading) {
    return <LoadingSkeleton />;
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
        <Button size="sm" variant="outline" onClick={() => { refetchMetrics(); refetchAdmin(); refetchHealth(); }} data-testid="button-refresh-metrics">
          <RefreshCw className="mr-2 h-3 w-3" />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={exportJson} disabled={!!exportLoading} data-testid="button-download-json">
          {exportLoading === "json" ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Download className="mr-2 h-3 w-3" />}
          Download JSON
        </Button>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!!exportLoading} data-testid="button-download-csv">
          {exportLoading === "csv" ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <FileSpreadsheet className="mr-2 h-3 w-3" />}
          Download CSV
        </Button>
        <Button size="sm" variant="outline" onClick={exportSummaryCsv} disabled={!!exportLoading} data-testid="button-csv-summary">
          {exportLoading === "summary" ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <FileSpreadsheet className="mr-2 h-3 w-3" />}
          CSV: Summary
        </Button>
        <Button size="sm" variant="outline" onClick={exportHealthCsv} disabled={!!exportLoading} data-testid="button-csv-health">
          {exportLoading === "health" ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <FileSpreadsheet className="mr-2 h-3 w-3" />}
          CSV: Health
        </Button>
        <Button size="sm" variant="outline" onClick={exportCacheCsv} disabled={!!exportLoading} data-testid="button-csv-cache">
          {exportLoading === "cache" ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <FileSpreadsheet className="mr-2 h-3 w-3" />}
          CSV: Redis/Cache
        </Button>
        <Button size="sm" variant="outline" onClick={exportRealtimeCsv} disabled={!!exportLoading} data-testid="button-csv-realtime">
          {exportLoading === "realtime" ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <FileSpreadsheet className="mr-2 h-3 w-3" />}
          CSV: Realtime
        </Button>
        <Button size="sm" variant="outline" onClick={exportGoogleCsv} disabled={!!exportLoading} data-testid="button-csv-google">
          {exportLoading === "google" ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <FileSpreadsheet className="mr-2 h-3 w-3" />}
          CSV: Google
        </Button>
        <Button size="sm" variant="outline" onClick={exportRoutesCsv} disabled={!!exportLoading} data-testid="button-csv-routes">
          {exportLoading === "routes" ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <FileSpreadsheet className="mr-2 h-3 w-3" />}
          CSV: Routes
        </Button>
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
          subtitle={req ? `4xx: ${req.errors_4xx_5min ?? req.total_errors_5min} / 5xx: ${req.errors_5xx_5min ?? 0}` : undefined}
          icon={AlertTriangle}
        />

        <MetricCard
          title="RPM (1 / 5 / 15 min)"
          value={req ? `${req.rpm_1min ?? "?"} / ${req.rpm_5min ?? "?"} / ${req.rpm_15min ?? "?"}` : "---"}
          subtitle={req ? `${req.total_requests_5min} total / 5min` : undefined}
          icon={BarChart3}
        />
      </div>

      {platformHealth && (
        <Card data-testid="card-platform-health">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium" data-testid="text-platform-health-title">Platform Health</CardTitle>
              <Badge
                variant={platformHealth.overallState === "CRITICAL" ? "destructive" : "default"}
                className={platformHealth.overallState === "HEALTHY" ? "bg-emerald-600 text-white" : platformHealth.overallState === "GOOD" ? "bg-blue-600 text-white" : ""}
                data-testid="badge-overall-health"
              >
                {platformHealth.overallState}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {([
                { key: "db", label: "Database", icon: DatabaseIcon, extra: (d: any) => d.latencyMs != null ? `${d.latencyMs}ms` : "" },
                { key: "api", label: "API", icon: Activity, extra: (d: any) => d.p95Ms != null ? `p95: ${d.p95Ms}ms` : "" },
                { key: "imports", label: "Imports", icon: ListChecks, extra: (d: any) => d.last24hJobs != null ? `${d.last24hJobs} jobs/24h` : "" },
                { key: "trips", label: "Trips", icon: Car, extra: (d: any) => d.activeTrips != null ? `${d.activeTrips} active` : "" },
                { key: "drivers", label: "Drivers", icon: Users, extra: (d: any) => d.activeDrivers != null ? `${d.activeDrivers} active` : "" },
                { key: "notifications", label: "SMS", icon: Radio, extra: (d: any) => d.smsSent24h != null ? `${d.smsSent24h} sent/24h` : "" },
              ] as const).map(({ key, label, icon: Ic, extra }) => {
                const metric = (platformHealth as any)[key] as HealthMetric | undefined;
                if (!metric) return null;
                const stateColor = metric.state === "CRITICAL" ? "text-red-600 dark:text-red-400" : metric.state === "GOOD" ? "text-blue-600 dark:text-blue-400" : "text-emerald-600 dark:text-emerald-400";
                const bgColor = metric.state === "CRITICAL" ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900" : metric.state === "GOOD" ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900" : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900";
                return (
                  <div key={key} className={`rounded-md border p-3 ${bgColor}`} data-testid={`health-card-${key}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Ic className={`h-3.5 w-3.5 ${stateColor}`} />
                      <span className="text-xs font-medium">{label}</span>
                    </div>
                    <div className={`text-sm font-semibold ${stateColor}`} data-testid={`health-state-${key}`}>{metric.state}</div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight" data-testid={`health-reason-${key}`}>{metric.reason}</p>
                    {extra(metric) && <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">{extra(metric)}</p>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

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

        <SystemLoadSection />
        <PerfProfileSection />
        <DriverIntelSection />
        <JobDashboardSection />
      </div>
    </div>
  );
}

interface SystemLoadData {
  ok: boolean;
  timestamp: string;
  app: { version: string; uptimeSec: number; nodeVersion: string; env: string; pid: number; platform: string; arch: string };
  cpu: { load1: number; load5: number; load15: number; cores: number };
  memory: { rssMB: number; heapUsedMB: number; heapTotalMB: number; externalMB: number; systemTotalMB: number; systemFreeMB: number };
  eventLoop: { lagMs: number };
  http: { reqPerMin: number; errPerMin: number; p50Ms: number; p95Ms: number; errors4xx5min: number; errors5xx5min: number; totalRequests5min: number; totalErrors5min: number; errorRatePct: number };
  db: { ok: boolean; latencyMs: number };
  build: { commit: string | null };
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function SystemLoadSection() {
  const lastGoodRef = useRef<SystemLoadData | null>(null);

  const { data, error, isLoading } = useQuery<SystemLoadData>({
    queryKey: ["/api/admin/metrics/system"],
    refetchInterval: 5000,
    retry: 1,
    staleTime: 4000,
  });

  if (data) {
    lastGoodRef.current = data;
  }

  const fetchError = error ? { status: 0, message: (error as any)?.message || "Network error" } : null;
  const display = data || lastGoodRef.current;

  return (
    <Card className="lg:col-span-2" data-testid="card-system-load">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          System Load
          {display?.timestamp && (
            <span className="text-xs font-normal text-muted-foreground ml-auto tabular-nums" data-testid="text-system-load-time">
              {formatTime(display.timestamp)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 space-y-3">
        {fetchError && (
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm space-y-1" data-testid="system-load-error">
            <p className="font-medium text-destructive">
              Failed to load system metrics
            </p>
            <p className="text-xs text-destructive/80 break-all">{fetchError.message}</p>
            {lastGoodRef.current && (
              <p className="text-xs text-muted-foreground">Showing last successful snapshot below.</p>
            )}
          </div>
        )}

        {!display && !fetchError && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {display && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div data-testid="metric-cpu-load">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">CPU Load (1/5/15)</p>
                </div>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-cpu-load">
                  {display.cpu.load1} / {display.cpu.load5} / {display.cpu.load15}
                </p>
                <p className="text-xs text-muted-foreground">{display.cpu.cores} cores</p>
              </div>

              <div data-testid="metric-memory">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Memory (RSS)</p>
                </div>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-memory-rss">
                  {display.memory.rssMB} MB
                </p>
                <p className="text-xs text-muted-foreground">
                  Heap: {display.memory.heapUsedMB}/{display.memory.heapTotalMB} MB
                </p>
              </div>

              <div data-testid="metric-event-loop">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Event Loop Lag</p>
                </div>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-event-loop-lag">
                  {display.eventLoop.lagMs} ms
                </p>
                <p className="text-xs text-muted-foreground">
                  {display.eventLoop.lagMs < 10 ? "Healthy" : display.eventLoop.lagMs < 50 ? "Moderate" : "High"}
                </p>
              </div>

              <div data-testid="metric-uptime">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Uptime</p>
                </div>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-uptime">
                  {formatUptime(display.app.uptimeSec)}
                </p>
                <p className="text-xs text-muted-foreground">
                  v{display.app.version} &middot; {display.app.nodeVersion}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div data-testid="metric-req-per-min">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Req/min</p>
                </div>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-req-per-min">
                  {display.http.reqPerMin}
                </p>
                <p className="text-xs text-muted-foreground">{display.http.totalRequests5min} total / 5min</p>
              </div>

              <div data-testid="metric-err-per-min">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Errors/min</p>
                </div>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-err-per-min">
                  {display.http.errPerMin}
                </p>
                <p className="text-xs text-muted-foreground">
                  {display.http.errorRatePct}% error rate
                </p>
              </div>

              <div data-testid="metric-p95">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">p95 Latency</p>
                </div>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-p95-latency">
                  {display.http.p95Ms} ms
                </p>
                <p className="text-xs text-muted-foreground">p50: {display.http.p50Ms} ms</p>
              </div>

              <div data-testid="metric-db-health">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <DatabaseIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Database</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant={display.db.ok ? "default" : "destructive"} data-testid="badge-db-status">
                    {display.db.ok ? "OK" : "DOWN"}
                  </Badge>
                  <span className="text-lg font-semibold tabular-nums" data-testid="text-db-latency-system">
                    {display.db.latencyMs}ms
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sys: {display.memory.systemFreeMB}/{display.memory.systemTotalMB} MB free
                </p>
              </div>
            </div>
          </>
        )}

        {!display && error && (
          <p className="text-xs text-muted-foreground text-center py-2" data-testid="text-system-load-no-data">
            No system load data available. Check server connectivity.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PerfProfileSection() {
  const { data: perf } = useQuery<any>({
    queryKey: ["/api/ops/perf/summary"],
    refetchInterval: 30000,
  });

  if (!perf?.ok) return null;

  const topRoutes = perf.routes || [];

  return (
    <Card className="lg:col-span-2" data-testid="card-perf-profile">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Cog className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          Performance Profiling
          {perf.profiling_enabled && (
            <Badge variant="secondary" className="text-[10px]">PROFILING ON</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Traced Requests</p>
            <p className="text-lg font-semibold tabular-nums" data-testid="text-traced-count">{perf.traced_count ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg DB Time</p>
            <p className="text-lg font-semibold tabular-nums" data-testid="text-avg-db-ms">{perf.avg_db_ms ?? 0}ms</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cache Hit Rate</p>
            <p className="text-lg font-semibold tabular-nums" data-testid="text-cache-hit-rate">
              {perf.cache_hit_rate ? `${Math.round(perf.cache_hit_rate * 100)}%` : "N/A"}
            </p>
          </div>
        </div>

        {topRoutes.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Slowest Routes (p95)</p>
            <div className="space-y-1">
              {topRoutes.slice(0, 5).map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs gap-2" data-testid={`perf-route-${i}`}>
                  <span className="font-mono truncate text-foreground flex-1">{r.route}</span>
                  <span className="tabular-nums text-muted-foreground whitespace-nowrap">{r.p95_ms}ms p95</span>
                  <span className="tabular-nums text-muted-foreground whitespace-nowrap">{r.count} calls</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {perf.n1_warnings && perf.n1_warnings.length > 0 && (
          <div>
            <p className="text-xs text-destructive mb-1">N+1 Query Warnings</p>
            <div className="space-y-1">
              {perf.n1_warnings.slice(0, 3).map((w: any, i: number) => (
                <div key={i} className="text-xs text-destructive/80" data-testid={`perf-n1-${i}`}>
                  {w.route}: {w.query_count} queries
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DriverIntelSection() {
  const [window, setWindow] = useState<"7d" | "30d">("7d");
  const [recomputing, setRecomputing] = useState(false);
  const { toast } = useToast();

  const { data: scoresData, isLoading: scoresLoading, refetch: refetchScores } = useQuery<any>({
    queryKey: [`/api/admin/ops-intel/scores?window=${window}`],
    refetchInterval: 60_000,
    retry: 1,
  });

  const { data: anomaliesData, isLoading: anomaliesLoading, refetch: refetchAnomalies } = useQuery<any>({
    queryKey: ["/api/admin/ops-intel/anomalies"],
    refetchInterval: 30_000,
    retry: 1,
  });

  async function handleRecompute() {
    setRecomputing(true);
    try {
      await apiRequest("POST", "/api/admin/ops-intel/scores/recompute", { window });
      toast({ title: `Scores recomputed (${window})` });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/ops-intel/scores?window=${window}`] });
    } catch {
      toast({ title: "Failed to recompute scores", variant: "destructive" });
    } finally {
      setRecomputing(false);
    }
  }

  async function handleExportCsv() {
    const showToastMsg = (msg: string) => toast({ title: msg, variant: "destructive" });
    const ok = await downloadWithAuth(
      `/api/admin/ops-intel/scores/csv?window=${window}`,
      `driver-scores-${window}-${buildTimestamp()}.csv`,
      "text/csv; charset=utf-8",
      rawAuthFetch,
      showToastMsg,
    );
    if (ok) toast({ title: `Downloaded driver scores CSV` });
  }

  const scores = scoresData?.scores || [];
  const anomalies = anomaliesData?.anomalies || [];

  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((sum: number, s: any) => sum + s.score, 0) / scores.length)
    : null;

  const highPerformers = scores.filter((s: any) => s.score >= 80).length;
  const needsAttention = scores.filter((s: any) => s.score < 50).length;

  if (scoresLoading && anomaliesLoading && !scoresData && !anomaliesData) return null;

  return (
    <Card className="lg:col-span-2" data-testid="card-driver-intel">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            Driver Intelligence
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={window} onValueChange={(v) => setWindow(v as "7d" | "30d")}>
              <SelectTrigger className="w-24" data-testid="select-score-window">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d" data-testid="select-item-7d">7 Days</SelectItem>
                <SelectItem value="30d" data-testid="select-item-30d">30 Days</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={handleRecompute} disabled={recomputing} data-testid="button-recompute-scores">
              {recomputing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              Recompute
            </Button>
            <Button size="sm" variant="outline" onClick={handleExportCsv} data-testid="button-export-scores-csv">
              <FileSpreadsheet className="mr-1 h-3 w-3" />
              CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Drivers Scored</p>
            <p className="text-lg font-semibold tabular-nums" data-testid="text-drivers-scored">{scores.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg Score</p>
            <p className="text-lg font-semibold tabular-nums" data-testid="text-avg-score">
              {avgScore !== null ? avgScore : "---"}
              {avgScore !== null && avgScore >= 70 && <TrendingUp className="inline ml-1 h-3 w-3 text-green-600" />}
              {avgScore !== null && avgScore < 50 && <TrendingDown className="inline ml-1 h-3 w-3 text-destructive" />}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">High Performers</p>
            <p className="text-lg font-semibold tabular-nums text-green-600" data-testid="text-high-performers">{highPerformers}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Needs Attention</p>
            <p className="text-lg font-semibold tabular-nums text-destructive" data-testid="text-needs-attention">{needsAttention}</p>
          </div>
        </div>

        {scores.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Driver Scores ({window})</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {scores
                .sort((a: any, b: any) => b.score - a.score)
                .map((s: any) => {
                  const c = s.components || {};
                  return (
                    <div key={s.id} className="flex items-center gap-2 text-xs" data-testid={`score-row-${s.driverId}`}>
                      <span className="font-medium min-w-[120px] truncate text-foreground">
                        {s.driverFirstName} {s.driverLastName}
                      </span>
                      <div className="flex-1 h-2 bg-muted rounded-md overflow-hidden">
                        <div
                          className={`h-full rounded-md ${
                            s.score >= 80
                              ? "bg-green-500"
                              : s.score >= 50
                                ? "bg-yellow-500"
                                : "bg-destructive"
                          }`}
                          style={{ width: `${s.score}%` }}
                        />
                      </div>
                      <span className="tabular-nums font-medium w-8 text-right text-foreground">{s.score}</span>
                      <UiTooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground cursor-help" data-testid={`tooltip-score-${s.driverId}`}>?</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">
                            Punctuality: {c.punctuality ?? "-"}/40 |
                            Completion: {c.completion ?? "-"}/25 |
                            Cancel: {c.cancellations ?? "-"}/15 |
                            GPS: {c.gpsQuality ?? "-"}/10 |
                            Accept: {c.acceptance ?? "-"}/10
                          </p>
                        </TooltipContent>
                      </UiTooltip>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {anomalies.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Active Anomalies</p>
            <div className="space-y-1">
              {anomalies.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 text-xs" data-testid={`anomaly-row-${a.id}`}>
                  <Badge
                    variant={a.severity === "critical" ? "destructive" : "secondary"}
                    className="text-[10px]"
                  >
                    {a.severity}
                  </Badge>
                  <span className="text-foreground flex-1 truncate">{a.title}</span>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {a.firstSeenAt ? new Date(a.firstSeenAt).toLocaleTimeString() : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {scores.length === 0 && anomalies.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2" data-testid="text-no-intel-data">
            No driver intelligence data yet. Scores will compute automatically.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function JobDashboardSection() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const queryParams = new URLSearchParams();
  queryParams.set("limit", "30");
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (typeFilter !== "all") queryParams.set("type", typeFilter);

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/ops/jobs", statusFilter, typeFilter],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token") || "";
      const res = await fetch(`/api/ops/jobs?${queryParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
    refetchInterval: 15_000,
    retry: 1,
  });

  const jobs = data?.jobs || [];
  const stats = data?.stats || { queued: 0, working: 0, succeeded: 0, failed: 0 };

  const statusColor = (s: string) => {
    switch (s) {
      case "succeeded": return "text-green-600 dark:text-green-400";
      case "failed": return "text-destructive";
      case "working": return "text-blue-600 dark:text-blue-400";
      case "queued": return "text-muted-foreground";
      default: return "text-muted-foreground";
    }
  };

  return (
    <Card className="lg:col-span-2" data-testid="card-job-dashboard">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            Job Dashboard
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-28" data-testid="select-job-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="select-item-all-status">All</SelectItem>
                <SelectItem value="queued" data-testid="select-item-queued">Queued</SelectItem>
                <SelectItem value="working" data-testid="select-item-working">Working</SelectItem>
                <SelectItem value="succeeded" data-testid="select-item-succeeded">Succeeded</SelectItem>
                <SelectItem value="failed" data-testid="select-item-failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-36" data-testid="select-job-type-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="select-item-all-type">All Types</SelectItem>
                <SelectItem value="eta_cycle" data-testid="select-item-eta-cycle">ETA Cycle</SelectItem>
                <SelectItem value="autoassign_cycle" data-testid="select-item-autoassign">Auto Assign</SelectItem>
                <SelectItem value="pdf_trip_details" data-testid="select-item-pdf">PDF</SelectItem>
                <SelectItem value="score_recompute" data-testid="select-item-score">Score</SelectItem>
                <SelectItem value="anomaly_sweep" data-testid="select-item-anomaly">Anomaly</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-refresh-jobs">
              <RefreshCw className="mr-1 h-3 w-3" />
              Refresh
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 space-y-3">
        <div className="grid grid-cols-4 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Queued</p>
            <p className="text-lg font-semibold tabular-nums" data-testid="text-jobs-queued">{stats.queued}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Working</p>
            <p className="text-lg font-semibold tabular-nums text-blue-600 dark:text-blue-400" data-testid="text-jobs-working">{stats.working}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Succeeded</p>
            <p className="text-lg font-semibold tabular-nums text-green-600 dark:text-green-400" data-testid="text-jobs-succeeded">{stats.succeeded}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Failed</p>
            <p className="text-lg font-semibold tabular-nums text-destructive" data-testid="text-jobs-failed">{stats.failed}</p>
          </div>
        </div>

        {isLoading && <Skeleton className="h-20 w-full" />}

        {!isLoading && jobs.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2" data-testid="text-no-jobs">
            No jobs found matching filters.
          </p>
        )}

        {!isLoading && jobs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="table-jobs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Type</th>
                  <th className="py-1 pr-2 font-medium">Status</th>
                  <th className="py-1 pr-2 font-medium">Attempts</th>
                  <th className="py-1 pr-2 font-medium">Created</th>
                  <th className="py-1 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j: any) => (
                  <tr key={j.id} className="border-b border-border/50" data-testid={`row-job-${j.id}`}>
                    <td className="py-1.5 pr-2">
                      <Badge variant="secondary" className="text-[10px]">{j.type}</Badge>
                    </td>
                    <td className={`py-1.5 pr-2 font-medium ${statusColor(j.status)}`}>
                      {j.status}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums">{j.attempts}/{j.maxAttempts}</td>
                    <td className="py-1.5 pr-2 text-muted-foreground whitespace-nowrap">
                      {j.createdAt ? new Date(j.createdAt).toLocaleTimeString() : ""}
                    </td>
                    <td className="py-1.5 max-w-[200px] truncate text-destructive" title={j.lastError || ""}>
                      {j.lastError ? (
                        <span className="flex items-center gap-1">
                          <XCircle className="h-3 w-3 flex-shrink-0" />
                          {j.lastError}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
