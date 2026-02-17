import { useState, useRef } from "react";
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
                  <Badge variant={statusVariant(job.status)} data-testid={`badge-status-${job.id}`}>{job.status}</Badge>
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

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await rawAuthFetch(`/api/admin/imports/${job.id}/validate`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Validation complete" });
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Validation failed", description: e.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await rawAuthFetch(`/api/admin/imports/${job.id}/run`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Import completed" });
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

  if (isLoading) return <Skeleton className="h-64" />;
  if (!job) return null;

  const summary = job.summaryJson as any;

  return (
    <div className="space-y-4">
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
            {["draft", "validated"].includes(job.status) && (
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
            {job.status === "validated" && (
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
            {["completed", "failed"].includes(job.status) && (
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
