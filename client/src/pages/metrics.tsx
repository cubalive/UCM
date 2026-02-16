import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Wifi,
  WifiOff,
  Database,
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

function csvEscape(val: unknown): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function arrayToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n");
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fileTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

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
    enabled: !!user && user.role === "SUPER_ADMIN",
  });

  const { data: googleData, isLoading: googleLoading } = useQuery<GoogleMetrics>({
    queryKey: ["/api/ops/metrics/google"],
    refetchInterval: 30_000,
    retry: 2,
    enabled: !!user && user.role === "SUPER_ADMIN",
  });

  const { data: healthData, isLoading: healthLoading } = useQuery<HealthData>({
    queryKey: ["/api/ops/health", selectedCity?.id],
    enabled: !!user && !!selectedCity?.id && ["SUPER_ADMIN", "ADMIN", "DISPATCH"].includes(user.role),
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!metrics}
            onClick={() => {
              const ts = fileTimestamp();
              const payload = {
                generatedAt: new Date().toISOString(),
                health: healthData ?? null,
                metrics: metrics ?? null,
                google: googleData ?? metrics?.google ?? null,
              };
              downloadFile(JSON.stringify(payload, null, 2), `ucm-metrics-${ts}.json`, "application/json");
            }}
            data-testid="button-download-json"
          >
            <Download className="mr-2 h-3 w-3" />
            Download JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!metrics}
            onClick={() => {
              const ts = fileTimestamp();
              const goog = googleData || metrics?.google;
              const row: Record<string, unknown> = {
                generatedAt: new Date().toISOString(),
                healthStatus: healthData?.overall ?? "N/A",
                p95LatencyMs: metrics?.request.p95_latency_ms ?? 0,
                errorRate: metrics?.request.error_rate_pct ?? 0,
                reqPer5Min: metrics?.request.total_requests_5min ?? 0,
                cacheHitRate: metrics?.redis.cache_hit_rate ?? 0,
                redisOk: metrics?.redis.redis_connected ? "yes" : "no",
                realtimePublishesPerMin_location: metrics?.realtime.realtime_broadcasts_by_type?.location ?? 0,
                realtimePublishesPerMin_eta: metrics?.realtime.realtime_broadcasts_by_type?.eta ?? 0,
                directionsCallsPerMin: goog?.directions_calls_per_min ?? 0,
                breakerOn: goog?.circuit_breaker?.open ? "yes" : "no",
              };
              downloadFile(arrayToCsv([row]), `ucm-metrics-summary-${ts}.csv`, "text/csv");
            }}
            data-testid="button-export-csv"
          >
            <FileSpreadsheet className="mr-2 h-3 w-3" />
            Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => refetchMetrics()} data-testid="button-refresh-metrics">
            <RefreshCw className="mr-2 h-3 w-3" />
            Refresh
          </Button>
        </div>
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
              <Database className="h-4 w-4 text-muted-foreground flex-shrink-0" />
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

        {/* Backpressure */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              Backpressure
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">p95 Latency</p>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-bp-p95">{bp?.p95_latency_ms ?? 0}ms</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Shed Rate</p>
                <p className="text-lg font-semibold tabular-nums">{bp?.shed_pct ?? 0}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Requests</p>
                <p className="text-sm font-semibold tabular-nums">{bp?.total_requests ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Rejected</p>
                <p className="text-sm font-semibold tabular-nums">{bp?.rejected_requests ?? 0}</p>
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
