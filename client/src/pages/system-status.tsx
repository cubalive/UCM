import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { apiFetch, resolveUrl } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import {
  RadialGauge,
  StatusPulse,
  AnimatedNumber,
  GlowAreaChart,
  KpiCard,
} from "@/components/charts/futuristic-charts";
import {
  Activity,
  CheckCircle,
  XCircle,
  RefreshCw,
  Server,
  Database,
  Shield,
  Clock,
  Zap,
  Play,
  Download,
  ChevronDown,
  ChevronRight,
  Building2,
  AlertTriangle,
  FileText,
  Loader2,
  Wrench,
  Cpu,
  HardDrive,
  Wifi,
  WifiOff,
  ArrowRight,
  Search,
} from "lucide-react";

// ─── Interfaces ──────────────────────────────────────────────────────────
interface SystemCheck {
  ok: boolean;
  latencyMs?: number;
  note?: string;
  value?: any;
}

interface FkCheck {
  ok: boolean;
  orphanCount: number;
  detail?: string;
}

interface SystemStatus {
  version: string;
  environment: string;
  baseUrl: string;
  uptime: number;
  memory: { rss: number; heapUsed: number };
  checks: Record<string, SystemCheck>;
  entityCounts: Record<string, number>;
  fkChecks?: Record<string, FkCheck>;
  latestSmokeRun: any;
  overallStatus: string;
  timestamp: string;
}

interface SmokeRun {
  id: number;
  environment: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  resultsJson: any;
}

interface ImportRun {
  id: string;
  companyId: number;
  companyName: string;
  sourceSystem: string;
  status: string;
  summaryJson: any;
  createdAt: string;
  updatedAt: string;
}

interface DiagnosticCheck {
  name: string;
  status: "ok" | "warning" | "critical";
  detail: string;
  fixable: boolean;
  fixAction?: string;
}

interface Diagnostics {
  uptime: number;
  memory: { rss: number; heapUsed: number };
  database: { ok: boolean; latencyMs: number };
  redis: { ok: boolean; latencyMs: number };
  integrityChecks: DiagnosticCheck[];
  timestamp: string;
}

// ─── Helper Components ───────────────────────────────────────────────────
function StatusIndicator({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle
      className="w-5 h-5 text-green-500"
      data-testid="icon-status-ok"
    />
  ) : (
    <XCircle
      className="w-5 h-5 text-red-500"
      data-testid="icon-status-fail"
    />
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
}

// ─── System Overview (Futuristic) ────────────────────────────────────────
function SystemOverview({ data }: { data: SystemStatus }) {
  const status = data.overallStatus;
  const pulseStatus =
    status === "healthy"
      ? ("healthy" as const)
      : status === "warning"
        ? ("warning" as const)
        : ("critical" as const);
  const bannerClass =
    status === "healthy"
      ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/30"
      : status === "warning"
        ? "border-yellow-300 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30"
        : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30";
  const textClass =
    status === "healthy"
      ? "text-green-800 dark:text-green-200"
      : status === "warning"
        ? "text-yellow-800 dark:text-yellow-200"
        : "text-red-800 dark:text-red-200";
  const statusLabel =
    status === "healthy"
      ? "System Healthy"
      : status === "warning"
        ? "System Warning"
        : "System Degraded";

  return (
    <div className="space-y-4">
      <div
        className={`flex items-center gap-3 p-4 rounded-xl border-2 ${bannerClass}`}
        data-testid="banner-overall-status"
      >
        <StatusPulse status={pulseStatus} size="lg" />
        <div>
          <div
            className={`text-xl font-bold ${textClass}`}
            data-testid="text-overall-status"
          >
            {statusLabel}
          </div>
          <div className="text-sm text-muted-foreground">
            v{data.version} | {data.environment} | Uptime:{" "}
            {formatUptime(data.uptime)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title="RSS Memory"
          value={data.memory.rss}
          suffix=" MB"
          color="cyan"
          icon={<HardDrive className="w-4 h-4 text-cyan-500" />}
          tooltip="Resident Set Size — total memory allocated to the Node.js process"
        />
        <KpiCard
          title="Heap Used"
          value={data.memory.heapUsed}
          suffix=" MB"
          color="purple"
          icon={<Cpu className="w-4 h-4 text-purple-500" />}
          tooltip="V8 heap memory in use — high values may indicate memory leaks"
        />
        <KpiCard
          title="Uptime"
          value={Math.floor(data.uptime / 3600)}
          suffix=" hrs"
          color="emerald"
          icon={<Clock className="w-4 h-4 text-emerald-500" />}
          tooltip="Hours since last server restart"
        />
        <KpiCard
          title="Environment"
          value={0}
          color="emerald"
          icon={<Server className="w-4 h-4 text-emerald-500" />}
          tooltip={`Running in ${data.environment} mode`}
        />
      </div>
    </div>
  );
}

// ─── Diagnostics Panel with Auto-Fix ─────────────────────────────────────
function DiagnosticsPanel({ token }: { token: string | null }) {
  const { toast } = useToast();

  const diagnosticsQuery = useQuery<Diagnostics>({
    queryKey: ["/api/analytics/system-diagnostics"],
    queryFn: () => apiFetch("/api/analytics/system-diagnostics", token),
    enabled: !!token,
    refetchInterval: 30000,
  });

  const fixMutation = useMutation({
    mutationFn: async (action: string) => {
      const res = await fetch(resolveUrl("/api/analytics/auto-fix"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "Fix Applied" : "Fix Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/analytics/system-diagnostics"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/ops/system-status"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Auto-fix failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const diag = diagnosticsQuery.data;

  if (diagnosticsQuery.isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (!diag) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <XCircle className="w-8 h-8 mx-auto text-red-500 mb-2" />
          <p className="text-muted-foreground">
            Failed to load diagnostics
          </p>
        </CardContent>
      </Card>
    );
  }

  const severityOrder = { critical: 0, warning: 1, ok: 2 };
  const sortedChecks = [...diag.integrityChecks].sort(
    (a, b) => severityOrder[a.status] - severityOrder[b.status]
  );

  const criticalCount = sortedChecks.filter(
    (c) => c.status === "critical"
  ).length;
  const warningCount = sortedChecks.filter(
    (c) => c.status === "warning"
  ).length;
  const okCount = sortedChecks.filter((c) => c.status === "ok").length;

  return (
    <div className="space-y-4">
      {/* Gauges row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="flex flex-col items-center py-4">
          <div className="relative">
            <RadialGauge
              value={diag.memory.heapUsed}
              max={1024}
              label="Heap Memory"
              color={
                diag.memory.heapUsed < 400
                  ? "emerald"
                  : diag.memory.heapUsed < 700
                    ? "amber"
                    : "rose"
              }
              size={100}
              formatValue={(v) => `${Math.round(v)}MB`}
            />
          </div>
        </Card>
        <Card className="flex flex-col items-center py-4">
          <div className="relative">
            <RadialGauge
              value={diag.database.latencyMs}
              max={500}
              label="DB Latency"
              color={
                diag.database.latencyMs < 50
                  ? "emerald"
                  : diag.database.latencyMs < 200
                    ? "amber"
                    : "rose"
              }
              size={100}
              formatValue={(v) => `${Math.round(v)}ms`}
            />
          </div>
        </Card>
        <Card className="flex flex-col items-center py-4">
          <div className="relative">
            <RadialGauge
              value={diag.redis.ok ? 100 : 0}
              max={100}
              label="Redis"
              color={diag.redis.ok ? "emerald" : "rose"}
              size={100}
              formatValue={() => (diag.redis.ok ? "Online" : "Offline")}
            />
          </div>
        </Card>
        <Card className="flex flex-col items-center py-4">
          <div className="relative">
            <RadialGauge
              value={okCount}
              max={sortedChecks.length}
              label="Checks Passing"
              color={
                criticalCount > 0
                  ? "rose"
                  : warningCount > 0
                    ? "amber"
                    : "emerald"
              }
              size={100}
              formatValue={(v) =>
                `${Math.round(v)}/${sortedChecks.length}`
              }
            />
          </div>
        </Card>
      </div>

      {/* Integrity Checks with Fix Buttons */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="w-5 h-5" />
                System Diagnostics
              </CardTitle>
              <InfoTooltip content="Automated system checks that run every 30 seconds. Issues with a 'Fix' button can be automatically resolved. Others show the root cause and where to investigate." />
            </div>
            <div className="flex items-center gap-2">
              {criticalCount > 0 && (
                <Badge variant="destructive">{criticalCount} Critical</Badge>
              )}
              {warningCount > 0 && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  {warningCount} Warning
                </Badge>
              )}
              <Badge variant="secondary">{okCount} OK</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {sortedChecks.map((check, idx) => (
            <div
              key={idx}
              className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                check.status === "critical"
                  ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
                  : check.status === "warning"
                    ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20"
                    : "border-border bg-muted/20"
              }`}
              data-testid={`diagnostic-check-${idx}`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <StatusPulse
                  status={
                    check.status === "ok"
                      ? "healthy"
                      : check.status === "warning"
                        ? "warning"
                        : "critical"
                  }
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{check.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {check.detail}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                {check.status !== "ok" && (
                  <>
                    {check.fixable && check.fixAction ? (
                      <Button
                        size="sm"
                        variant="default"
                        className="gap-1.5"
                        onClick={() =>
                          fixMutation.mutate(check.fixAction!)
                        }
                        disabled={fixMutation.isPending}
                        data-testid={`button-fix-${idx}`}
                      >
                        {fixMutation.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Wrench className="w-3.5 h-3.5" />
                        )}
                        Auto-Fix
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Search className="w-3.5 h-3.5" />
                        <span>
                          {check.status === "critical"
                            ? "Investigate manually"
                            : "Monitor"}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {check.status === "ok" && (
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Health Checks ───────────────────────────────────────────────────────
function HealthChecks({
  checks,
}: {
  checks: Record<string, SystemCheck>;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Health Checks
          </CardTitle>
          <InfoTooltip content="Low-level health checks for each system component. Green = healthy, Red = failing. Check latency values for performance degradation." />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {Object.entries(checks).map(([name, check]) => (
          <div
            key={name}
            className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
            data-testid={`check-row-${name}`}
          >
            <div className="flex items-center gap-2">
              <StatusIndicator ok={check.ok} />
              <span className="font-medium text-sm capitalize">
                {name.replace(/([A-Z])/g, " $1").trim()}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {check.latencyMs !== undefined && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {check.latencyMs}ms
                </Badge>
              )}
              {check.note && <span>{check.note}</span>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── External Keys Card ──────────────────────────────────────────────────
function ExternalKeysCard({
  keys,
}: {
  keys: Record<string, boolean>;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="w-5 h-5" />
            External Service Keys
          </CardTitle>
          <InfoTooltip content="Configuration status of external API keys. Red items need to be set in environment variables for that service to work." />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(keys).map(([key, present]) => (
            <div
              key={key}
              className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/20"
              data-testid={`key-${key}`}
            >
              <StatusIndicator ok={present} />
              <span className="font-mono text-xs flex-1">{key}</span>
              {!present && (
                <Badge variant="destructive" className="text-[9px]">
                  MISSING
                </Badge>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── FK Checks Card ──────────────────────────────────────────────────────
function FkChecksCard({
  fkChecks,
}: {
  fkChecks: Record<string, FkCheck>;
}) {
  const hasIssues = Object.values(fkChecks).some((f) => !f.ok);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Data Integrity (FK Checks)
            {hasIssues && (
              <Badge variant="destructive" className="ml-2" data-testid="badge-fk-issues">
                Issues Found
              </Badge>
            )}
          </CardTitle>
          <InfoTooltip content="Foreign key integrity checks — orphaned records indicate data that references deleted parent records. These can cause UI errors and should be fixed." />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {Object.entries(fkChecks).map(([name, check]) => (
          <div
            key={name}
            className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
            data-testid={`fk-check-${name}`}
          >
            <div className="flex items-center gap-2">
              <StatusIndicator ok={check.ok} />
              <span className="font-medium text-sm">{name}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {check.ok
                ? "No orphaned records"
                : `${check.orphanCount} orphaned records`}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Entity Counts ───────────────────────────────────────────────────────
function EntityCounts({
  counts,
}: {
  counts: Record<string, number>;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="w-5 h-5" />
            Entity Counts
          </CardTitle>
          <InfoTooltip content="Total record counts for each entity table in the database. Use to verify data integrity and growth trends." />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {Object.entries(counts).map(([entity, count]) => (
            <div
              key={entity}
              className="text-center p-3 rounded-xl bg-muted/40 border hover:border-primary/20 transition-colors"
              data-testid={`count-${entity}`}
            >
              <div className="text-xl font-bold">
                <AnimatedNumber value={count} />
              </div>
              <div className="text-xs text-muted-foreground capitalize">
                {entity.replace(/_/g, " ")}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Smoke Test Panel ────────────────────────────────────────────────────
function SmokeTestPanel({ token }: { token: string | null }) {
  const { toast } = useToast();
  const [expandedRun, setExpandedRun] = useState<number | null>(null);

  const runsQuery = useQuery<{ runs: SmokeRun[] }>({
    queryKey: ["/api/ops/smoke-runs"],
    queryFn: () => apiFetch("/api/ops/smoke-runs", token),
    enabled: !!token,
    refetchInterval: 5000,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(resolveUrl("/api/ops/smoke-run"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Smoke test started" });
      queryClient.invalidateQueries({
        queryKey: ["/api/ops/smoke-runs"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to start smoke test",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const runs = runsQuery.data?.runs || [];
  const latestRun = runs[0];

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Play className="w-5 h-5" />
            Smoke Tests
          </CardTitle>
          <InfoTooltip content="End-to-end smoke tests that verify critical system pathways — auth, DB, API routes. Run manually or scheduled to catch regressions." />
        </div>
        <Button
          size="sm"
          onClick={() => runMutation.mutate()}
          disabled={
            runMutation.isPending || latestRun?.status === "running"
          }
          data-testid="button-run-smoke"
        >
          {runMutation.isPending || latestRun?.status === "running" ? (
            <>
              <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-1" /> Run Smoke Test
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No smoke tests run yet.
          </p>
        ) : (
          runs.slice(0, 5).map((run) => {
            const results = run.resultsJson as any;
            const steps = results?.steps || [];
            const summary = results?.summary;
            const isExpanded = expandedRun === run.id;

            return (
              <div
                key={run.id}
                className="border rounded-xl overflow-hidden"
                data-testid={`smoke-run-${run.id}`}
              >
                <button
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                  onClick={() =>
                    setExpandedRun(isExpanded ? null : run.id)
                  }
                  data-testid={`button-expand-run-${run.id}`}
                >
                  <div className="flex items-center gap-2">
                    {run.status === "running" ? (
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                    ) : run.status === "passed" ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className="text-sm font-medium">
                      Run #{run.id}
                    </span>
                    <Badge
                      variant={
                        run.status === "passed"
                          ? "default"
                          : run.status === "running"
                            ? "secondary"
                            : "destructive"
                      }
                      data-testid={`badge-run-status-${run.id}`}
                    >
                      {run.status.toUpperCase()}
                    </Badge>
                    {summary && (
                      <span className="text-xs text-muted-foreground">
                        {summary.passed}/{summary.total} passed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString()}
                    </span>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </div>
                </button>
                {isExpanded && steps.length > 0 && (
                  <div className="border-t px-3 py-2 space-y-1.5 bg-muted/10">
                    {steps.map((step: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-sm"
                        data-testid={`smoke-step-${idx}`}
                      >
                        {step.pass ? (
                          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        )}
                        <span className="font-medium">{step.name}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {step.pass ? step.detail : step.error}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ─── Import Runs Panel ───────────────────────────────────────────────────
function ImportRunsPanel({ token }: { token: string | null }) {
  const [expandedImport, setExpandedImport] = useState<string | null>(
    null
  );
  const [eventsData, setEventsData] = useState<Record<string, any>>({});

  const importsQuery = useQuery<{ imports: ImportRun[] }>({
    queryKey: ["/api/ops/import-runs"],
    queryFn: () => apiFetch("/api/ops/import-runs", token),
    enabled: !!token,
  });

  const imports = importsQuery.data?.imports || [];

  const loadEvents = async (jobId: string) => {
    if (eventsData[jobId]) {
      setExpandedImport(expandedImport === jobId ? null : jobId);
      return;
    }
    try {
      const data = await apiFetch(
        `/api/ops/import-runs/${jobId}/events`,
        token
      );
      setEventsData((prev) => ({ ...prev, [jobId]: data }));
      setExpandedImport(jobId);
    } catch {}
  };

  const downloadErrorCsv = (jobId: string) => {
    const data = eventsData[jobId];
    if (!data?.errorCsv) return;
    const blob = new Blob([data.errorCsv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import_errors_${jobId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Import Runs
          </CardTitle>
          <InfoTooltip content="History of data import jobs — clinics, patients, drivers, vehicles. Expand to see detailed event logs and download error CSV files." />
        </div>
      </CardHeader>
      <CardContent>
        {imports.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No import runs found.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((imp) => {
                const summary = imp.summaryJson as any;
                const results = summary?.results;

                return (
                  <TableRow
                    key={imp.id}
                    data-testid={`import-row-${imp.id}`}
                  >
                    <TableCell className="font-mono text-xs">
                      {imp.id.slice(0, 8)}
                    </TableCell>
                    <TableCell>{imp.companyName}</TableCell>
                    <TableCell>{imp.sourceSystem}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          imp.status === "completed"
                            ? "default"
                            : imp.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                        data-testid={`badge-import-status-${imp.id}`}
                      >
                        {imp.status}
                      </Badge>
                      {results && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {Object.entries(results).map(
                            ([e, r]: any) => (
                              <span key={e} className="mr-2">
                                {e}: {r.inserted}ins {r.updated}upd{" "}
                                {r.errors}err
                              </span>
                            )
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(imp.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => loadEvents(imp.id)}
                          data-testid={`button-view-events-${imp.id}`}
                        >
                          {expandedImport === imp.id ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </Button>
                        {eventsData[imp.id]?.errorCount > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => downloadErrorCsv(imp.id)}
                            data-testid={`button-download-errors-${imp.id}`}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Company Overview Panel ──────────────────────────────────────────────
function CompanyOverviewPanel({ token }: { token: string | null }) {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");

  const companiesQuery = useQuery<any[]>({
    queryKey: ["/api/companies"],
    enabled: !!token,
  });

  const overviewQuery = useQuery<any>({
    queryKey: ["/api/ops/company", selectedCompanyId, "overview"],
    queryFn: () =>
      apiFetch(
        `/api/ops/company/${selectedCompanyId}/overview`,
        token
      ),
    enabled: !!token && !!selectedCompanyId,
  });

  const companies = companiesQuery.data || [];
  const overview = overviewQuery.data;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Company Data Overview
          </CardTitle>
          <InfoTooltip content="Select a company to see data overview — record counts, data quality, and entity distribution across the system." />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {companies.map((c: any) => (
            <Button
              key={c.id}
              size="sm"
              variant={
                selectedCompanyId === String(c.id)
                  ? "default"
                  : "outline"
              }
              onClick={() => setSelectedCompanyId(String(c.id))}
              data-testid={`button-company-${c.id}`}
            >
              {c.name}
            </Button>
          ))}
        </div>

        {overview && (
          <div className="space-y-3">
            {overview.warning && (
              <div
                className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800"
                data-testid="warning-no-data"
              >
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
                <span className="text-sm text-yellow-800 dark:text-yellow-200">
                  {overview.warning}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { key: "clinics", label: "Clinics", link: "/clinics" },
                {
                  key: "patients",
                  label: "Patients",
                  link: "/patients",
                },
                { key: "drivers", label: "Drivers", link: "/drivers" },
                {
                  key: "vehicles",
                  label: "Vehicles",
                  link: "/vehicles",
                },
                { key: "trips", label: "Trips", link: "/trips" },
              ].map(({ key, label, link }) => (
                <a
                  key={key}
                  href={link}
                  className="text-center p-3 rounded-xl bg-muted/40 hover:bg-muted/60 border hover:border-primary/20 transition-all"
                  data-testid={`company-count-${key}`}
                >
                  <div className="text-2xl font-bold">
                    <AnimatedNumber value={overview[key] || 0} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {label}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────
export default function SystemStatusPage() {
  const { token, user } = useAuth();
  const { toast } = useToast();

  const statusQuery = useQuery<SystemStatus>({
    queryKey: ["/api/ops/system-status"],
    queryFn: () => apiFetch("/api/ops/system-status", token),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const data = statusQuery.data;
  const externalKeys = data?.checks?.externalKeys?.value;
  const checksWithoutKeys = data?.checks
    ? Object.fromEntries(
        Object.entries(data.checks).filter(
          ([k]) => k !== "externalKeys" && k !== "dataIntegrity"
        )
      )
    : {};

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          Access denied. SUPER_ADMIN only.
        </p>
      </div>
    );
  }

  return (
    <div
      className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto"
      data-testid="page-system-status"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Server className="w-6 h-6 text-muted-foreground" />
          <div>
            <h1
              className="text-2xl font-bold"
              data-testid="text-page-title"
            >
              System Status
            </h1>
            <p className="text-sm text-muted-foreground">
              Ops overview, diagnostics, auto-fix, and smoke tests
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => statusQuery.refetch()}
          disabled={statusQuery.isFetching}
          data-testid="button-refresh-status"
        >
          <RefreshCw
            className={`w-4 h-4 mr-1 ${statusQuery.isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {statusQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : data ? (
        <Tabs defaultValue="diagnostics" className="space-y-4">
          <TabsList data-testid="tabs-system-status">
            <TabsTrigger value="diagnostics">
              <Wrench className="w-4 h-4 mr-1.5" />
              Diagnostics
            </TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="smoke">Smoke Tests</TabsTrigger>
            <TabsTrigger value="imports">Import Runs</TabsTrigger>
            <TabsTrigger value="company">Company Data</TabsTrigger>
          </TabsList>

          <TabsContent value="diagnostics" className="space-y-4">
            <SystemOverview data={data} />
            <DiagnosticsPanel token={token} />
          </TabsContent>

          <TabsContent value="overview" className="space-y-4">
            <SystemOverview data={data} />
            <HealthChecks checks={checksWithoutKeys} />
            {externalKeys && <ExternalKeysCard keys={externalKeys} />}
            <EntityCounts counts={data.entityCounts} />
            {data.fkChecks &&
              Object.keys(data.fkChecks).length > 0 && (
                <FkChecksCard fkChecks={data.fkChecks} />
              )}
          </TabsContent>

          <TabsContent value="smoke" className="space-y-4">
            <SmokeTestPanel token={token} />
          </TabsContent>

          <TabsContent value="imports" className="space-y-4">
            <ImportRunsPanel token={token} />
          </TabsContent>

          <TabsContent value="company" className="space-y-4">
            <CompanyOverviewPanel token={token} />
          </TabsContent>
        </Tabs>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <XCircle className="w-8 h-8 mx-auto text-red-500 mb-2" />
            <p className="text-muted-foreground">
              Failed to load system status
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
