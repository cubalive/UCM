import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, CheckCircle, XCircle, RefreshCw, Server, Database,
  Shield, Clock, Zap, Play, Download, ChevronDown, ChevronRight,
  Building2, AlertTriangle, FileText, Loader2,
} from "lucide-react";

interface SystemCheck {
  ok: boolean;
  latencyMs?: number;
  note?: string;
  value?: any;
}

interface SystemStatus {
  version: string;
  environment: string;
  baseUrl: string;
  uptime: number;
  memory: { rss: number; heapUsed: number };
  checks: Record<string, SystemCheck>;
  entityCounts: Record<string, number>;
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

function StatusIndicator({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle className="w-5 h-5 text-green-500" data-testid="icon-status-ok" />
  ) : (
    <XCircle className="w-5 h-5 text-red-500" data-testid="icon-status-fail" />
  );
}

function CheckRow({ name, check }: { name: string; check: SystemCheck }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30 hover:bg-muted/50" data-testid={`check-row-${name}`}>
      <div className="flex items-center gap-2">
        <StatusIndicator ok={check.ok} />
        <span className="font-medium text-sm capitalize">{name.replace(/([A-Z])/g, " $1").trim()}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {check.latencyMs !== undefined && <span>{check.latencyMs}ms</span>}
        {check.note && <span>{check.note}</span>}
      </div>
    </div>
  );
}

function SystemOverview({ data }: { data: SystemStatus }) {
  const overallOk = data.overallStatus === "healthy";
  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-3 p-4 rounded-lg border-2 ${overallOk ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/30" : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"}`} data-testid="banner-overall-status">
        {overallOk ? (
          <CheckCircle className="w-8 h-8 text-green-500" />
        ) : (
          <XCircle className="w-8 h-8 text-red-500" />
        )}
        <div>
          <div className={`text-xl font-bold ${overallOk ? "text-green-800 dark:text-green-200" : "text-red-800 dark:text-red-200"}`} data-testid="text-overall-status">
            {overallOk ? "System Healthy" : "System Degraded"}
          </div>
          <div className="text-sm text-muted-foreground">
            v{data.version} | {data.environment} | Uptime: {formatUptime(data.uptime)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-memory-rss">{data.memory.rss}MB</div>
            <div className="text-xs text-muted-foreground">RSS Memory</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-memory-heap">{data.memory.heapUsed}MB</div>
            <div className="text-xs text-muted-foreground">Heap Used</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-uptime">{formatUptime(data.uptime)}</div>
            <div className="text-xs text-muted-foreground">Uptime</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-env">{data.environment}</div>
            <div className="text-xs text-muted-foreground">Environment</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HealthChecks({ checks }: { checks: Record<string, SystemCheck> }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Health Checks
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {Object.entries(checks).map(([name, check]) => (
          <CheckRow key={name} name={name} check={check} />
        ))}
      </CardContent>
    </Card>
  );
}

function ExternalKeysCard({ keys }: { keys: Record<string, boolean> }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Zap className="w-5 h-5" />
          External Keys
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(keys).map(([key, present]) => (
            <div key={key} className="flex items-center gap-2 text-sm" data-testid={`key-${key}`}>
              <StatusIndicator ok={present} />
              <span className="font-mono text-xs">{key}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EntityCounts({ counts }: { counts: Record<string, number> }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Database className="w-5 h-5" />
          Entity Counts
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {Object.entries(counts).map(([entity, count]) => (
            <div key={entity} className="text-center p-2 rounded-md bg-muted/40" data-testid={`count-${entity}`}>
              <div className="text-xl font-bold">{count}</div>
              <div className="text-xs text-muted-foreground capitalize">{entity.replace(/_/g, " ")}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

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
      const res = await fetch("/api/ops/smoke-run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Smoke test started" });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/smoke-runs"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start smoke test", description: err.message, variant: "destructive" });
    },
  });

  const runs = runsQuery.data?.runs || [];
  const latestRun = runs[0];

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Play className="w-5 h-5" />
          Smoke Tests
        </CardTitle>
        <Button
          size="sm"
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending || (latestRun?.status === "running")}
          data-testid="button-run-smoke"
        >
          {runMutation.isPending || latestRun?.status === "running" ? (
            <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Running...</>
          ) : (
            <><Play className="w-4 h-4 mr-1" /> Run Smoke Test</>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No smoke tests run yet.</p>
        ) : (
          runs.slice(0, 5).map(run => {
            const results = run.resultsJson as any;
            const steps = results?.steps || [];
            const summary = results?.summary;
            const isExpanded = expandedRun === run.id;

            return (
              <div key={run.id} className="border rounded-md" data-testid={`smoke-run-${run.id}`}>
                <button
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/30"
                  onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                  data-testid={`button-expand-run-${run.id}`}
                >
                  <div className="flex items-center gap-2">
                    {run.status === "running" ? (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    ) : run.status === "passed" ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className="text-sm font-medium">Run #{run.id}</span>
                    <Badge variant={run.status === "passed" ? "default" : run.status === "running" ? "secondary" : "destructive"} data-testid={`badge-run-status-${run.id}`}>
                      {run.status.toUpperCase()}
                    </Badge>
                    {summary && (
                      <span className="text-xs text-muted-foreground">{summary.passed}/{summary.total} passed</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</span>
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>
                </button>
                {isExpanded && steps.length > 0 && (
                  <div className="border-t px-3 py-2 space-y-1.5">
                    {steps.map((step: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 text-sm" data-testid={`smoke-step-${idx}`}>
                        {step.pass ? (
                          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        )}
                        <span className="font-medium">{step.name}</span>
                        <span className="text-xs text-muted-foreground truncate">{step.pass ? step.detail : step.error}</span>
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

function ImportRunsPanel({ token }: { token: string | null }) {
  const [expandedImport, setExpandedImport] = useState<string | null>(null);
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
      const data = await apiFetch(`/api/ops/import-runs/${jobId}/events`, token);
      setEventsData(prev => ({ ...prev, [jobId]: data }));
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
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Import Runs
        </CardTitle>
      </CardHeader>
      <CardContent>
        {imports.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No import runs found.</p>
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
              {imports.map(imp => {
                const summary = imp.summaryJson as any;
                const results = summary?.results;
                const isExpanded = expandedImport === imp.id;

                return (
                  <TableRow key={imp.id} data-testid={`import-row-${imp.id}`}>
                    <TableCell className="font-mono text-xs">{imp.id.slice(0, 8)}</TableCell>
                    <TableCell>{imp.companyName}</TableCell>
                    <TableCell>{imp.sourceSystem}</TableCell>
                    <TableCell>
                      <Badge variant={imp.status === "completed" ? "default" : imp.status === "failed" ? "destructive" : "secondary"} data-testid={`badge-import-status-${imp.id}`}>
                        {imp.status}
                      </Badge>
                      {results && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {Object.entries(results).map(([e, r]: any) => (
                            <span key={e} className="mr-2">{e}: {r.inserted}ins {r.updated}upd {r.errors}err</span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{new Date(imp.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => loadEvents(imp.id)} data-testid={`button-view-events-${imp.id}`}>
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </Button>
                        {eventsData[imp.id]?.errorCount > 0 && (
                          <Button size="sm" variant="ghost" onClick={() => downloadErrorCsv(imp.id)} data-testid={`button-download-errors-${imp.id}`}>
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

function CompanyOverviewPanel({ token }: { token: string | null }) {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");

  const companiesQuery = useQuery<any[]>({
    queryKey: ["/api/companies"],
    enabled: !!token,
  });

  const overviewQuery = useQuery<any>({
    queryKey: ["/api/ops/company", selectedCompanyId, "overview"],
    queryFn: () => apiFetch(`/api/ops/company/${selectedCompanyId}/overview`, token),
    enabled: !!token && !!selectedCompanyId,
  });

  const companies = companiesQuery.data || [];
  const overview = overviewQuery.data;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Company Data Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {companies.map((c: any) => (
            <Button
              key={c.id}
              size="sm"
              variant={selectedCompanyId === String(c.id) ? "default" : "outline"}
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
              <div className="flex items-center gap-2 p-3 rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800" data-testid="warning-no-data">
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
                <span className="text-sm text-yellow-800 dark:text-yellow-200">{overview.warning}</span>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { key: "clinics", label: "Clinics", link: "/clinics" },
                { key: "patients", label: "Patients", link: "/patients" },
                { key: "drivers", label: "Drivers", link: "/drivers" },
                { key: "vehicles", label: "Vehicles", link: "/vehicles" },
                { key: "trips", label: "Trips", link: "/trips" },
              ].map(({ key, label, link }) => (
                <a key={key} href={link} className="text-center p-3 rounded-md bg-muted/40 hover:bg-muted/60 transition-colors" data-testid={`company-count-${key}`}>
                  <div className="text-2xl font-bold">{overview[key]}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </a>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

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
    ? Object.fromEntries(Object.entries(data.checks).filter(([k]) => k !== "externalKeys" && k !== "dataIntegrity"))
    : {};

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Access denied. SUPER_ADMIN only.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto" data-testid="page-system-status">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Server className="w-6 h-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">System Status</h1>
            <p className="text-sm text-muted-foreground">Ops overview, health checks, and smoke tests</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => statusQuery.refetch()}
          disabled={statusQuery.isFetching}
          data-testid="button-refresh-status"
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${statusQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {statusQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : data ? (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList data-testid="tabs-system-status">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="smoke">Smoke Tests</TabsTrigger>
            <TabsTrigger value="imports">Import Runs</TabsTrigger>
            <TabsTrigger value="company">Company Data</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <SystemOverview data={data} />
            <HealthChecks checks={checksWithoutKeys} />
            {externalKeys && <ExternalKeysCard keys={externalKeys} />}
            <EntityCounts counts={data.entityCounts} />
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
            <p className="text-muted-foreground">Failed to load system status</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
