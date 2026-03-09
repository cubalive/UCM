import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { rawAuthFetch } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  FileText,
  Building2,
  Users,
  Truck,
  Car,
  Loader2,
  Eye,
  Download,
  Search,
  Info,
  Trash2,
} from "lucide-react";

const ENTITIES = [
  { key: "clinics", label: "Clinics", icon: Building2 },
  { key: "patients", label: "Patients", icon: Users },
  { key: "drivers", label: "Drivers", icon: Truck },
  { key: "vehicles", label: "Vehicles", icon: Car },
];

const SOURCE_SYSTEMS = [
  { value: "supabase", label: "Supabase Export" },
  { value: "excel_generic", label: "Excel / CSV (Generic)" },
  { value: "uber_health_like", label: "Uber Health Export" },
  { value: "other", label: "Other" },
];

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed": return "default";
    case "validated": return "secondary";
    case "running": return "outline";
    case "failed": return "destructive";
    case "rolled_back": return "destructive";
    default: return "outline";
  }
}

export default function DataImportPage() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: ["/api/admin/imports"],
    queryFn: async () => {
      const res = await rawAuthFetch("/api/admin/imports");
      if (!res.ok) throw new Error("Failed to load import jobs");
      return res.json();
    },
    staleTime: 10000,
  });

  const jobDetailQuery = useQuery({
    queryKey: ["/api/admin/imports", selectedJobId],
    queryFn: async () => {
      if (!selectedJobId) return null;
      const res = await rawAuthFetch(`/api/admin/imports/${selectedJobId}`);
      if (!res.ok) throw new Error("Failed to load job details");
      return res.json();
    },
    enabled: !!selectedJobId,
    staleTime: 5000,
  });

  const companiesQuery = useQuery({
    queryKey: ["/api/admin/health/deep"],
    queryFn: async () => {
      const res = await rawAuthFetch("/api/admin/health/deep");
      if (!res.ok) return { companies: [] };
      return res.json();
    },
    staleTime: 60000,
  });

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto" data-testid="page-data-import">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Data Import</h1>
          <p className="text-sm text-muted-foreground">Import clinics, patients, drivers, and vehicles from external sources</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <TemplateDownloadMenu />
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-import">
                <Plus className="w-4 h-4 mr-1" /> New Import Job
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Import Job</DialogTitle>
              </DialogHeader>
              <CreateJobForm
                onCreated={(id) => { setCreateOpen(false); setSelectedJobId(id); queryClient.invalidateQueries({ queryKey: ["/api/admin/imports"] }); }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Import History</h2>
          {jobsQuery.isLoading && <Skeleton className="h-32" />}
          {jobsQuery.data?.length === 0 && (
            <Card><CardContent className="p-4 text-sm text-muted-foreground">No import jobs yet</CardContent></Card>
          )}
          {jobsQuery.data?.map((job: any) => (
            <Card
              key={job.id}
              className={`cursor-pointer hover-elevate ${selectedJobId === job.id ? "ring-2 ring-primary" : ""}`}
              onClick={() => setSelectedJobId(job.id)}
              data-testid={`card-job-${job.id}`}
            >
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-medium">{job.sourceSystem}</span>
                  <div className="flex items-center gap-1">
                    <Badge variant={statusVariant(job.status)} data-testid={`badge-status-${job.id}`}>{job.status}</Badge>
                    {job.status === "draft" && (
                      <DeleteDraftButton jobId={job.id} onDeleted={() => {
                        if (selectedJobId === job.id) setSelectedJobId(null);
                        queryClient.invalidateQueries({ queryKey: ["/api/admin/imports"] });
                      }} />
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Company #{job.companyId} {job.cityId ? `| City #${job.cityId}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(job.createdAt).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="lg:col-span-2">
          {selectedJobId ? (
            <JobDetailPanel
              job={jobDetailQuery.data}
              isLoading={jobDetailQuery.isLoading}
              onRefresh={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/admin/imports", selectedJobId] });
                queryClient.invalidateQueries({ queryKey: ["/api/admin/imports"] });
              }}
            />
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Upload className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p>Select an import job or create a new one</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateDownloadMenu() {
  const { toast } = useToast();

  const downloadTemplate = async (entity: string) => {
    try {
      const res = await rawAuthFetch(`/api/admin/imports/templates/${entity}`);
      if (!res.ok) throw new Error("Failed to download template");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entity}_template.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `${entity} template downloaded` });
    } catch (e: any) {
      toast({ title: "Download failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-download-templates">
          <Download className="w-4 h-4 mr-1" /> Templates
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download CSV Templates</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Download pre-formatted CSV templates with the correct headers for each entity type.
        </p>
        <div className="grid grid-cols-2 gap-2 pt-2">
          {ENTITIES.map(ent => {
            const Icon = ent.icon;
            return (
              <Button
                key={ent.key}
                variant="outline"
                className="justify-start"
                onClick={() => downloadTemplate(ent.key)}
                data-testid={`button-template-${ent.key}`}
              >
                <Icon className="w-4 h-4 mr-2" />
                {ent.label}
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateJobForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState("1");
  const [cityId, setCityId] = useState("");
  const [sourceSystem, setSourceSystem] = useState("excel_generic");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await rawAuthFetch("/api/admin/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: parseInt(companyId),
          cityId: cityId ? parseInt(cityId) : null,
          sourceSystem,
          consentConfirmed: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create job");
      }
      const job = await res.json();
      toast({ title: "Import job created" });
      onCreated(job.id);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Company ID</Label>
        <Input
          type="number" value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          data-testid="input-company-id"
        />
      </div>
      <div>
        <Label>City ID (optional)</Label>
        <Input
          type="number" value={cityId} placeholder="Leave empty for default"
          onChange={(e) => setCityId(e.target.value)}
          data-testid="input-city-id"
        />
      </div>
      <div>
        <Label>Source System</Label>
        <Select value={sourceSystem} onValueChange={setSourceSystem}>
          <SelectTrigger data-testid="select-source-system">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_SYSTEMS.map(s => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={handleCreate} disabled={loading || !companyId} className="w-full" data-testid="button-submit-create">
        {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
        Create Job
      </Button>
    </div>
  );
}

function JobDetailPanel({ job, isLoading, onRefresh }: { job: any; isLoading: boolean; onRefresh: () => void }) {
  const { toast } = useToast();
  const [dryRunResults, setDryRunResults] = useState<any>(null);
  const [showDryRun, setShowDryRun] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [progress, setProgress] = useState<any>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    setIsPolling(true);
    const poll = async () => {
      try {
        const res = await rawAuthFetch(`/api/admin/imports/${jobId}/status`);
        if (!res.ok) {
          if (res.status === 403 || res.status === 401) { stopPolling(); }
          return;
        }
        const data = await res.json();
        setProgress(data.progress);
        if (data.status === "completed") {
          stopPolling();
          toast({ title: "Import completed successfully" });
          onRefresh();
          queryClient.invalidateQueries({ queryKey: ["/api/admin/imports/company", job?.companyId, "health"] });
        } else if (data.status === "failed") {
          stopPolling();
          toast({ title: "Import failed", variant: "destructive" });
          onRefresh();
        }
      } catch { }
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
  }, [stopPolling, onRefresh, toast, job?.companyId]);

  useEffect(() => {
    if (job?.status === "running") {
      startPolling(job.id);
    }
    return stopPolling;
  }, [job?.id, job?.status, startPolling, stopPolling]);

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await rawAuthFetch(`/api/admin/imports/${job.id}/validate`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Validation complete" });
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Validation failed", description: e.message, variant: "destructive" }),
  });

  const dryRunMutation = useMutation({
    mutationFn: async () => {
      const res = await rawAuthFetch(`/api/admin/imports/${job.id}/dry-run`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: (data) => {
      setDryRunResults(data.results);
      setShowDryRun(true);
      toast({ title: "Dry run complete" });
    },
    onError: (e: any) => toast({ title: "Dry run failed", description: e.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await rawAuthFetch(`/api/admin/imports/${job.id}/run`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Import started" });
      startPolling(job.id);
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const rollbackMutation = useMutation({
    mutationFn: async () => {
      const res = await rawAuthFetch(`/api/admin/imports/${job.id}/rollback`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Rollback complete: ${data.removed} records removed` });
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Rollback failed", description: e.message, variant: "destructive" }),
  });

  const healthQuery = useQuery({
    queryKey: ["/api/admin/imports/company", job?.companyId, "health"],
    queryFn: async () => {
      const res = await rawAuthFetch(`/api/admin/imports/company/${job.companyId}/health`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!job?.companyId,
    staleTime: 10000,
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (!job) return null;

  const summary = job.summaryJson as any;
  const hasFiles = job.files?.length > 0;
  const isRunning = job.status === "running" || isPolling;
  const progressPercent = progress?.percent ?? 0;

  return (
    <div className="space-y-4">
      {isRunning && (
        <Card className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20" data-testid="card-running-banner">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                  Import running{progress?.entity ? ` — processing ${progress.entity}` : ""}
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                  {progress ? `${progress.current} / ${progress.total} rows (${progressPercent}%)` : "Starting..."}
                </p>
              </div>
            </div>
            <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-md h-3 overflow-hidden" data-testid="div-progress-bar">
              <div
                className="h-full bg-blue-600 dark:bg-blue-400 rounded-md transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {progress?.results && Object.keys(progress.results).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {Object.entries(progress.results).map(([entity, r]: [string, any]) => (
                  <div key={entity} className="bg-blue-100 dark:bg-blue-900/50 rounded-md p-1.5 text-center">
                    <div className="font-medium capitalize">{entity}</div>
                    <div className="text-blue-700 dark:text-blue-300">{r.inserted} ins / {r.updated} upd</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {job.status === "validated" && !isRunning && (
        <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20" data-testid="card-validated-banner">
          <CardContent className="p-3 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Validated — No data inserted yet
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                This job has been validated successfully. Click "Run Import" below to commit the data to the database.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {job.status === "completed" && !isRunning && (
        <Card className="border-green-500/50 bg-green-50 dark:bg-green-950/20" data-testid="card-completed-banner">
          <CardContent className="p-3 flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                Import completed — Data has been inserted
              </p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                All validated records have been committed to the database for Company #{job.companyId}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {(job.status === "failed" || job.status === "rolled_back") && !isRunning && (
        <Card className="border-red-500/50 bg-red-50 dark:bg-red-950/20" data-testid="card-failed-banner">
          <CardContent className="p-3 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                {job.status === "failed" ? "Import failed" : "Import was rolled back"}
              </p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                {job.status === "failed"
                  ? "The import encountered an error. Check the event log below for details. You can fix the issue and re-upload/re-validate."
                  : "This import was rolled back. All inserted records have been removed. You can create a new import job to try again."}
              </p>
              {summary?.error && (
                <p className="text-xs text-red-600 dark:text-red-300 mt-1 font-mono bg-red-100 dark:bg-red-900/30 p-1 rounded">
                  {summary.error}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-lg">
            Job: {job.sourceSystem}
          </CardTitle>
          <Badge variant={statusVariant(job.status)} data-testid="badge-job-status">{job.status}</Badge>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-4 flex-wrap text-muted-foreground">
            <span>ID: {job.id.slice(0, 8)}...</span>
            <span>Company: #{job.companyId}</span>
            {job.cityId && <span>City: #{job.cityId}</span>}
            <span>Created: {new Date(job.createdAt).toLocaleString()}</span>
          </div>

          <div className="flex gap-2 flex-wrap pt-2">
            {hasFiles && ["draft", "validated"].includes(job.status) && !isRunning && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => dryRunMutation.mutate()}
                disabled={dryRunMutation.isPending}
                data-testid="button-dry-run"
              >
                {dryRunMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
                Dry Run Preview
              </Button>
            )}
            {["draft", "validated"].includes(job.status) && !isRunning && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => validateMutation.mutate()}
                disabled={validateMutation.isPending}
                data-testid="button-validate"
              >
                {validateMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                Validate
              </Button>
            )}
            {job.status === "validated" && !isRunning && (
              <Button
                size="sm"
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending}
                data-testid="button-run-import"
              >
                {runMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                Run Import
              </Button>
            )}
            {["completed", "failed"].includes(job.status) && !isRunning && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => rollbackMutation.mutate()}
                disabled={rollbackMutation.isPending}
                data-testid="button-rollback"
              >
                {rollbackMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1" />}
                Rollback
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {healthQuery.data && (
        <Card data-testid="card-import-health">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base">Company Data Health</CardTitle>
            <Badge variant="outline">{healthQuery.data.companyName}</Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-3">
              {Object.entries(healthQuery.data.counts).map(([entity, count]: [string, any]) => (
                <div key={entity} className="text-center p-2 bg-muted rounded-md" data-testid={`health-count-${entity}`}>
                  <div className="text-lg font-bold">{count}</div>
                  <div className="text-xs text-muted-foreground capitalize">{entity}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ENTITIES.map(ent => (
          <EntityUploadCard
            key={ent.key}
            entity={ent}
            jobId={job.id}
            jobStatus={job.status}
            existingFile={job.files?.find((f: any) => f.entity === ent.key)}
            onUploaded={onRefresh}
          />
        ))}
      </div>

      {showDryRun && dryRunResults && (
        <DryRunResultsPanel results={dryRunResults} onClose={() => setShowDryRun(false)} />
      )}

      {summary?.counts && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Validation Results</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead>Valid</TableHead>
                  <TableHead>Errors</TableHead>
                  <TableHead>Skipped (dupes)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(summary.counts).map(([entity, c]: [string, any]) => (
                  <TableRow key={entity}>
                    <TableCell className="font-medium">{entity}</TableCell>
                    <TableCell><Badge variant="default">{c.ok}</Badge></TableCell>
                    <TableCell>{c.error > 0 ? <Badge variant="destructive">{c.error}</Badge> : <span className="text-muted-foreground">0</span>}</TableCell>
                    <TableCell className="text-muted-foreground">{c.skipped}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {summary?.results && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Import Results</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead>Inserted</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Errors</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(summary.results).map(([entity, r]: [string, any]) => (
                  <TableRow key={entity}>
                    <TableCell className="font-medium">{entity}</TableCell>
                    <TableCell><Badge variant="default">{r.inserted}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{r.updated}</Badge></TableCell>
                    <TableCell>{r.errors > 0 ? <Badge variant="destructive">{r.errors}</Badge> : <span className="text-muted-foreground">0</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {job.events?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Event Log</CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 overflow-y-auto">
            <div className="space-y-1">
              {job.events.slice(0, 50).map((evt: any) => (
                <div key={evt.id} className="flex items-start gap-2 text-xs border-b pb-1">
                  <Badge
                    variant={evt.level === "error" ? "destructive" : evt.level === "warn" ? "secondary" : "outline"}
                    className="shrink-0"
                  >
                    {evt.level}
                  </Badge>
                  <span className="flex-1 break-all">{evt.message}</span>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(evt.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DryRunResultsPanel({ results, onClose }: { results: Record<string, any>; onClose: () => void }) {
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);

  return (
    <Card data-testid="card-dry-run-results">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Eye className="w-4 h-4" /> Dry Run Preview
        </CardTitle>
        <Button size="sm" variant="outline" onClick={onClose} data-testid="button-close-dry-run">
          Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(results).map(([entity, r]: [string, any]) => (
          <div key={entity} className="space-y-2">
            <div
              className="flex items-center justify-between gap-2 flex-wrap cursor-pointer"
              onClick={() => setExpandedEntity(expandedEntity === entity ? null : entity)}
              data-testid={`dry-run-entity-${entity}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium capitalize">{entity}</span>
                <Badge variant="secondary" className="text-xs">{r.totalRows} rows</Badge>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="default">{r.validRows} valid</Badge>
                {r.errorRows > 0 && <Badge variant="destructive">{r.errorRows} errors</Badge>}
                {r.duplicateRows > 0 && <Badge variant="outline">{r.duplicateRows} dupes</Badge>}
              </div>
            </div>

            {r.headerInfo?.unmapped?.length > 0 && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                <span>Unmapped columns: {r.headerInfo.unmapped.join(", ")}</span>
              </div>
            )}

            {r.headerInfo?.mapped && Object.keys(r.headerInfo.mapped).length > 0 && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
                <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-green-600" />
                <span>
                  Mapped: {Object.entries(r.headerInfo.mapped).map(([from, to]) =>
                    from !== to ? `${from} -> ${to}` : from
                  ).join(", ")}
                </span>
              </div>
            )}

            {r.missingRequiredFields?.length > 0 && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 p-2 rounded-md">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>Missing required: {r.missingRequiredFields.join(", ")}</span>
              </div>
            )}

            {r.rowErrors?.length > 0 && expandedEntity === entity && (
              <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
                {r.rowErrors.slice(0, 20).map((err: any, idx: number) => (
                  <div key={idx} className="text-xs text-destructive">
                    {err.message}
                  </div>
                ))}
                {r.rowErrors.length > 20 && (
                  <div className="text-xs text-muted-foreground">...and {r.rowErrors.length - 20} more errors</div>
                )}
              </div>
            )}

            {r.preview?.length > 0 && expandedEntity === entity && (
              <div className="overflow-x-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {Object.keys(r.preview[0]).filter(k => !k.startsWith("_")).slice(0, 8).map(col => (
                        <TableHead key={col} className="text-xs whitespace-nowrap">{col}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.preview.slice(0, 5).map((row: any, idx: number) => (
                      <TableRow key={idx}>
                        {Object.keys(r.preview[0]).filter(k => !k.startsWith("_")).slice(0, 8).map(col => (
                          <TableCell key={col} className="text-xs max-w-[150px] truncate">
                            {String(row[col] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DeleteDraftButton({ jobId, onDeleted }: { jobId: string; onDeleted: () => void }) {
  const { toast } = useToast();
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await rawAuthFetch(`/api/admin/imports/${jobId}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Draft deleted" });
      onDeleted();
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-6 w-6 text-muted-foreground hover:text-destructive"
      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(); }}
      disabled={deleteMutation.isPending}
      data-testid={`button-delete-${jobId}`}
    >
      {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
    </Button>
  );
}

function EntityUploadCard({
  entity,
  jobId,
  jobStatus,
  existingFile,
  onUploaded,
}: {
  entity: { key: string; label: string; icon: any };
  jobId: string;
  jobStatus: string;
  existingFile?: any;
  onUploaded: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const Icon = entity.icon;

  const canUpload = ["draft", "validated"].includes(jobStatus);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await rawAuthFetch(
        `/api/admin/imports/${jobId}/upload?entity=${entity.key}`,
        { method: "POST", body: formData }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      toast({ title: `${entity.label} file uploaded` });
      onUploaded();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card data-testid={`card-upload-${entity.key}`}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">{entity.label}</span>
          </div>
          {existingFile && (
            <Badge variant="secondary" className="text-xs">
              <FileText className="w-3 h-3 mr-1" />
              {existingFile.filename}
            </Badge>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
          }}
          data-testid={`input-file-${entity.key}`}
        />

        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={!canUpload || uploading}
          onClick={() => fileRef.current?.click()}
          data-testid={`button-upload-${entity.key}`}
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <Upload className="w-4 h-4 mr-1" />
          )}
          {existingFile ? "Replace File" : "Upload CSV / XLSX / JSON"}
        </Button>
      </CardContent>
    </Card>
  );
}
