import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { apiFetch, rawAuthFetch, getStoredCompanyScopeId, setStoredCompanyScopeId } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  Upload,
  Download,
  Plus,
  CheckCircle,
  XCircle,
  Send,
  Loader2,
  FileSpreadsheet,
  DollarSign,
  Save,
  RotateCcw,
  Pencil,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}
function getMonthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().split("T")[0];
}

function statusVariant(status: string) {
  switch (status) {
    case "APPROVED": return "default" as const;
    case "PAID": return "default" as const;
    case "SUBMITTED": return "secondary" as const;
    case "REJECTED": return "destructive" as const;
    default: return "outline" as const;
  }
}

export default function TimecardsPage() {
  const { token, user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const [activeTab, setActiveTab] = useState<"entries" | "payrates">("entries");
  const [companyScopeId, setCompanyScopeIdLocal] = useState<string | null>(getStoredCompanyScopeId());
  const hasCompanyScope = isSuperAdmin ? !!companyScopeId : true;

  const companiesQuery = useQuery<any[]>({
    queryKey: ["/api/companies"],
    queryFn: () => apiFetch("/api/companies", token),
    enabled: !!token && isSuperAdmin,
  });

  const handleCompanyChange = (value: string) => {
    setStoredCompanyScopeId(value);
    setCompanyScopeIdLocal(value);
    queryClient.invalidateQueries();
    window.dispatchEvent(new CustomEvent("ucm-scope-changed"));
  };

  if (isSuperAdmin && !hasCompanyScope) {
    const companies = companiesQuery.data || [];
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-4" data-testid="timecards-no-company">
        <Building2 className="w-10 h-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Select a Company</h2>
        <p className="text-sm text-muted-foreground">Choose a company to manage timecards</p>
        <div className="w-full max-w-xs">
          {companiesQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : companiesQuery.isError ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-destructive">Failed to load companies</p>
              <Button variant="outline" size="sm" onClick={() => companiesQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : companies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No companies found.</p>
          ) : (
            <Select onValueChange={handleCompanyChange}>
              <SelectTrigger className="w-64" data-testid="select-company-scope">
                <SelectValue placeholder="Select company..." />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-[1400px] mx-auto" data-testid="timecards-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Timecards</h1>
        {isSuperAdmin && companyScopeId && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs" data-testid="badge-company-scope">
              <Building2 className="w-3 h-3 mr-1" />
              {(companiesQuery.data || []).find((c: any) => String(c.id) === companyScopeId)?.name || `Company #${companyScopeId}`}
            </Badge>
            <Select value={companyScopeId} onValueChange={handleCompanyChange}>
              <SelectTrigger className="w-48" data-testid="select-change-company">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(companiesQuery.data || []).map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex border-b" data-testid="tab-navigation">
        <button
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            activeTab === "entries"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
          )}
          onClick={() => setActiveTab("entries")}
          data-testid="tab-time-entries"
        >
          <Clock className="inline-block mr-1.5 h-4 w-4" />
          Time Entries
        </button>
        <button
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            activeTab === "payrates"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
          )}
          onClick={() => setActiveTab("payrates")}
          data-testid="tab-staff-pay-rates"
        >
          <DollarSign className="inline-block mr-1.5 h-4 w-4" />
          Staff Pay Rates
        </button>
      </div>

      {activeTab === "entries" ? <TimeEntriesTab /> : <StaffPayRatesTab />}
    </div>
  );
}

function TimeEntriesTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [from, setFrom] = useState(getMonthAgo());
  const [to, setTo] = useState(getToday());
  const [driverFilter, setDriverFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editEntry, setEditEntry] = useState<any>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const driverParam = driverFilter && driverFilter !== "all" ? `&driver_id=${driverFilter}` : "";

  const entriesQuery = useQuery({
    queryKey: ["/api/company/time/entries", from, to, driverFilter],
    queryFn: () => apiFetch(`/api/company/time/entries?from=${from}&to=${to}${driverParam}`, token),
    enabled: !!token,
  });

  const driversQuery = useQuery({
    queryKey: ["/api/company/time/drivers"],
    queryFn: () => apiFetch("/api/company/time/drivers", token),
    enabled: !!token,
  });

  const batchesQuery = useQuery({
    queryKey: ["/api/company/time/import-batches"],
    queryFn: () => apiFetch("/api/company/time/import-batches?limit=10", token),
    enabled: !!token,
  });

  const approveMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/company/time/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
      toast({ title: "Approved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rejectMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/company/time/${id}/reject`, { reason: "Rejected by admin" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
      toast({ title: "Rejected" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const submitMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/company/time/${id}/submit`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
      toast({ title: "Submitted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const markPaidMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/company/time/${id}/mark-paid`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
      toast({ title: "Marked as paid" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const entries: any[] = entriesQuery.data || [];
  const driversList: any[] = driversQuery.data || [];

  const totalHours = entries.reduce((s, e) => s + (parseFloat(e.hoursNumeric) || 0), 0);
  const approvedCount = entries.filter((e) => e.status === "APPROVED").length;
  const pendingCount = entries.filter((e) => e.status === "DRAFT" || e.status === "SUBMITTED").length;
  const totalEstimatedCost = entries.reduce((s, e) => {
    const hrs = parseFloat(e.hoursNumeric) || 0;
    const rateCents = e.hourlyRateCents || 0;
    return s + (hrs * rateCents);
  }, 0);
  const paidCount = entries.filter((e) => e.status === "PAID").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
          queryClient.invalidateQueries({ queryKey: ["/api/company/time/drivers"] });
          queryClient.invalidateQueries({ queryKey: ["/api/company/time/import-batches"] });
          toast({ title: "Refreshed" });
        }} data-testid="button-refresh-entries">
          <RotateCcw className="mr-1 h-4 w-4" /> Refresh
        </Button>
        <Button onClick={() => setShowCreate(true)} data-testid="button-create-entry">
          <Plus className="mr-1 h-4 w-4" /> Manual Entry
        </Button>
        <Button variant="outline" onClick={() => setShowImport(true)} data-testid="button-import-csv">
          <Upload className="mr-1 h-4 w-4" /> Import CSV
        </Button>
        <Button variant="ghost" onClick={() => {
          window.open("/api/company/time/csv-template", "_blank");
        }} data-testid="button-download-template">
          <Download className="mr-1 h-4 w-4" /> Template
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Hours</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-hours">{totalHours.toFixed(1)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Est. Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-estimated-cost">${(totalEstimatedCost / 100).toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">{paidCount} paid / {approvedCount} approved</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-approved-count">{approvedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-pending-count">{pendingCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" data-testid="input-date-from" />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" data-testid="input-date-to" />
            </div>
            <div>
              <Label>Driver</Label>
              <Select value={driverFilter} onValueChange={setDriverFilter}>
                <SelectTrigger className="w-48" data-testid="select-driver-filter">
                  <SelectValue placeholder="All drivers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All drivers</SelectItem>
                  {driversList.map((d: any) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.firstName} {d.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {entries.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t">
              {entries.some((e: any) => e.status === "DRAFT" || e.status === "SUBMITTED") && (
                <Button size="sm" disabled={bulkProcessing} onClick={async () => {
                  setBulkProcessing(true);
                  const toApprove = entries.filter((e: any) => e.status === "DRAFT" || e.status === "SUBMITTED");
                  let ok = 0, fail = 0;
                  for (const e of toApprove) {
                    try { await apiRequest("POST", `/api/company/time/${e.id}/approve`); ok++; } catch { fail++; }
                  }
                  queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
                  setBulkProcessing(false);
                  toast({ title: fail > 0 ? `${ok} approved, ${fail} failed` : `${ok} entries approved` });
                }} data-testid="button-approve-all">
                  {bulkProcessing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1 h-4 w-4" />}
                  Approve All ({entries.filter((e: any) => e.status === "DRAFT" || e.status === "SUBMITTED").length})
                </Button>
              )}
              {entries.some((e: any) => e.status === "APPROVED") && (
                <Button size="sm" variant="outline" disabled={bulkProcessing} onClick={async () => {
                  setBulkProcessing(true);
                  const toMark = entries.filter((e: any) => e.status === "APPROVED");
                  let ok = 0, fail = 0;
                  for (const e of toMark) {
                    try { await apiRequest("POST", `/api/company/time/${e.id}/mark-paid`); ok++; } catch { fail++; }
                  }
                  queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
                  setBulkProcessing(false);
                  toast({ title: fail > 0 ? `${ok} marked paid, ${fail} failed` : `${ok} entries marked as paid` });
                }} data-testid="button-mark-paid-all">
                  {bulkProcessing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <DollarSign className="mr-1 h-4 w-4" />}
                  Mark All Paid ({entries.filter((e: any) => e.status === "APPROVED").length})
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {entriesQuery.isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-entries">No time entries found for this period</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e: any) => (
                    <TableRow key={e.id} data-testid={`row-time-entry-${e.id}`}>
                      <TableCell className="font-medium" data-testid={`text-driver-name-${e.id}`}>{e.driverName}</TableCell>
                      <TableCell>{e.workDate}</TableCell>
                      <TableCell>{parseFloat(e.hoursNumeric).toFixed(1)}</TableCell>
                      <TableCell>{e.hourlyRateCents ? `$${(e.hourlyRateCents / 100).toFixed(2)}` : "-"}</TableCell>
                      <TableCell><Badge variant={e.sourceType === "SHIFT" ? "secondary" : "outline"} data-testid={`badge-source-type-${e.id}`}>{e.sourceType === "SHIFT" ? "Auto (Shift)" : e.sourceType}</Badge></TableCell>
                      <TableCell><Badge variant={statusVariant(e.status)} data-testid={`badge-status-${e.id}`}>{e.status}</Badge></TableCell>
                      <TableCell className="max-w-[200px] truncate">{e.notes || "-"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(e.status === "DRAFT") && (
                            <Button size="sm" variant="outline" onClick={() => submitMut.mutate(e.id)} data-testid={`button-submit-${e.id}`}>
                              <Send className="h-3 w-3" />
                            </Button>
                          )}
                          {(e.status === "DRAFT" || e.status === "SUBMITTED") && (
                            <Button size="sm" onClick={() => approveMut.mutate(e.id)} data-testid={`button-approve-${e.id}`}>
                              <CheckCircle className="h-3 w-3" />
                            </Button>
                          )}
                          {e.status === "APPROVED" && (
                            <Button size="sm" variant="outline" onClick={() => markPaidMut.mutate(e.id)} data-testid={`button-mark-paid-${e.id}`}>
                              <DollarSign className="h-3 w-3" />
                            </Button>
                          )}
                          {(e.status !== "PAID" && e.status !== "REJECTED") && (
                            <Button size="sm" variant="destructive" onClick={() => rejectMut.mutate(e.id)} data-testid={`button-reject-${e.id}`}>
                              <XCircle className="h-3 w-3" />
                            </Button>
                          )}
                          {(e.status === "DRAFT" || e.status === "REJECTED") && (
                            <Button size="sm" variant="ghost" onClick={() => setEditEntry(e)} data-testid={`button-edit-${e.id}`}>
                              Edit
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {batchesQuery.data && (batchesQuery.data as any[]).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Imports</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Skipped</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(batchesQuery.data as any[]).map((b: any) => (
                  <TableRow key={b.id} data-testid={`row-import-batch-${b.id}`}>
                    <TableCell>{b.filename}</TableCell>
                    <TableCell>{b.rowCount}</TableCell>
                    <TableCell>{b.createdCount}</TableCell>
                    <TableCell>{b.skippedCount}</TableCell>
                    <TableCell><Badge variant={b.status === "PROCESSED" ? "default" : "destructive"}>{b.status}</Badge></TableCell>
                    <TableCell>{formatDate(b.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CreateEntryDialog open={showCreate} onClose={() => setShowCreate(false)} drivers={driversList} token={token} />
      <ImportCSVDialog open={showImport} onClose={() => setShowImport(false)} token={token} />
      {editEntry && <EditEntryDialog entry={editEntry} onClose={() => setEditEntry(null)} token={token} />}
    </div>
  );
}

function formatCentsToDisplay(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

function parseDollarsToCents(val: string): number | null {
  if (!val.trim()) return null;
  const num = parseFloat(val);
  if (isNaN(num)) return null;
  return Math.round(num * 100);
}

function formatBps(bps: number | null | undefined): string {
  if (bps == null) return "";
  return (bps / 100).toFixed(2);
}

function parseBps(val: string): number | null {
  if (!val.trim()) return null;
  const num = parseFloat(val);
  if (isNaN(num)) return null;
  return Math.round(num * 100);
}

interface PayRateRow {
  driver: { id: number; firstName: string; lastName: string; email: string | null; phone: string; status: string };
  payConfig: any | null;
  effectivePayType: string;
  effectiveHourlyRateCents: number | null;
  effectivePerTripFlatCents: number | null;
  effectivePerTripPercentBps: number | null;
  effectiveFixedSalaryCents: number | null;
  hasOverride: boolean;
}

function StaffPayRatesTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPayType, setEditPayType] = useState("HOURLY");
  const [editHourlyRate, setEditHourlyRate] = useState("");
  const [editFixedSalary, setEditFixedSalary] = useState("");
  const [editFixedPeriod, setEditFixedPeriod] = useState("MONTHLY");
  const [editPerTripFlat, setEditPerTripFlat] = useState("");
  const [editPerTripPercent, setEditPerTripPercent] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [onboardingDriverId, setOnboardingDriverId] = useState<number | null>(null);

  const payConfigsQuery = useQuery({
    queryKey: ["/api/company/staff-pay-configs"],
    queryFn: () => apiFetch("/api/company/staff-pay-configs", token),
  });

  const stripeStatusesQuery = useQuery<{ statuses: Record<string, { stripeAccountId: string; status: string; payoutsEnabled: boolean; detailsSubmitted: boolean }> }>({
    queryKey: ["/api/company/driver-stripe-statuses"],
    queryFn: () => apiFetch("/api/company/driver-stripe-statuses", token),
  });

  const stripeStatuses = stripeStatusesQuery.data?.statuses || {};

  const onboardMut = useMutation({
    mutationFn: (driverId: number) => apiRequest("POST", `/api/company/driver/${driverId}/stripe-onboarding`),
    onSuccess: (data: any) => {
      if (data.url) {
        window.open(data.url, "_blank");
        toast({ title: "Stripe onboarding link opened in new tab" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/company/driver-stripe-statuses"] });
      setOnboardingDriverId(null);
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setOnboardingDriverId(null);
    },
  });

  const upsertMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/company/staff-pay-configs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/staff-pay-configs"] });
      toast({ title: "Pay configuration saved" });
      setEditingId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (configId: number) => apiRequest("DELETE", `/api/company/staff-pay-configs/${configId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/staff-pay-configs"] });
      toast({ title: "Pay override removed, using company defaults" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const data = payConfigsQuery.data as { drivers: PayRateRow[]; companyDefaults: any } | undefined;
  const rows = data?.drivers || [];
  const defaults = data?.companyDefaults;

  const filteredRows = rows.filter((r) => {
    if (!searchFilter.trim()) return true;
    const name = `${r.driver.firstName} ${r.driver.lastName}`.toLowerCase();
    return name.includes(searchFilter.toLowerCase());
  });

  function startEdit(row: PayRateRow) {
    setEditingId(row.driver.id);
    setEditPayType(row.payConfig?.payType || row.effectivePayType || "HOURLY");
    setEditHourlyRate(formatCentsToDisplay(row.payConfig?.hourlyRateCents ?? row.effectiveHourlyRateCents));
    setEditFixedSalary(formatCentsToDisplay(row.payConfig?.fixedSalaryCents ?? row.effectiveFixedSalaryCents));
    setEditFixedPeriod(row.payConfig?.fixedPeriod || "MONTHLY");
    setEditPerTripFlat(formatCentsToDisplay(row.payConfig?.perTripFlatCents ?? row.effectivePerTripFlatCents));
    setEditPerTripPercent(formatBps(row.payConfig?.perTripPercentBps ?? row.effectivePerTripPercentBps));
    setEditNotes(row.payConfig?.notes || "");
  }

  function handleSave(driverId: number) {
    upsertMut.mutate({
      driverId,
      payType: editPayType,
      hourlyRateCents: editPayType === "HOURLY" ? parseDollarsToCents(editHourlyRate) : null,
      fixedSalaryCents: editPayType === "FIXED" ? parseDollarsToCents(editFixedSalary) : null,
      fixedPeriod: editPayType === "FIXED" ? editFixedPeriod : null,
      perTripFlatCents: editPayType === "PER_TRIP" ? parseDollarsToCents(editPerTripFlat) : null,
      perTripPercentBps: editPayType === "PER_TRIP" ? parseBps(editPerTripPercent) : null,
      notes: editNotes,
    });
  }

  function payTypeLabel(pt: string) {
    switch (pt) {
      case "HOURLY": return "Hourly";
      case "FIXED": return "Fixed Salary";
      case "PER_TRIP": return "Per Trip";
      default: return pt;
    }
  }

  function renderEffectiveRate(row: PayRateRow) {
    const pt = row.effectivePayType;
    if (pt === "HOURLY" && row.effectiveHourlyRateCents != null) {
      return `$${(row.effectiveHourlyRateCents / 100).toFixed(2)}/hr`;
    }
    if (pt === "FIXED" && row.effectiveFixedSalaryCents != null) {
      return `$${(row.effectiveFixedSalaryCents / 100).toFixed(2)}/mo`;
    }
    if (pt === "PER_TRIP") {
      const parts = [];
      if (row.effectivePerTripFlatCents != null) parts.push(`$${(row.effectivePerTripFlatCents / 100).toFixed(2)}/trip`);
      if (row.effectivePerTripPercentBps != null) parts.push(`${(row.effectivePerTripPercentBps / 100).toFixed(2)}%`);
      return parts.join(" + ") || "-";
    }
    return "-";
  }

  return (
    <div className="space-y-4">
      {defaults && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Company Defaults</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Default Pay Mode:</span>{" "}
                <Badge variant="outline" data-testid="badge-company-pay-mode">{payTypeLabel(defaults.payMode)}</Badge>
              </div>
              {defaults.hourlyRateCents != null && (
                <div>
                  <span className="text-muted-foreground">Hourly Rate:</span>{" "}
                  <span className="font-medium" data-testid="text-company-hourly-rate">${(defaults.hourlyRateCents / 100).toFixed(2)}/hr</span>
                </div>
              )}
              {defaults.perTripFlatCents != null && (
                <div>
                  <span className="text-muted-foreground">Per Trip Flat:</span>{" "}
                  <span className="font-medium" data-testid="text-company-trip-flat">${(defaults.perTripFlatCents / 100).toFixed(2)}</span>
                </div>
              )}
              {defaults.perTripPercentBps != null && (
                <div>
                  <span className="text-muted-foreground">Per Trip %:</span>{" "}
                  <span className="font-medium" data-testid="text-company-trip-percent">{(defaults.perTripPercentBps / 100).toFixed(2)}%</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Drivers without a custom pay configuration will use these company defaults.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-lg">Driver Pay Rates</CardTitle>
            <div className="w-64">
              <Input
                placeholder="Search drivers..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                data-testid="input-search-drivers"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {payConfigsQuery.isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : filteredRows.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-drivers">No drivers found</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Pay Type</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Stripe</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => {
                    const isEditing = editingId === row.driver.id;

                    if (isEditing) {
                      return (
                        <TableRow key={row.driver.id} className="bg-muted/30" data-testid={`row-pay-config-edit-${row.driver.id}`}>
                          <TableCell className="font-medium">
                            {row.driver.firstName} {row.driver.lastName}
                            {row.driver.email && <div className="text-xs text-muted-foreground">{row.driver.email}</div>}
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.driver.status === "ACTIVE" ? "default" : "secondary"}>{row.driver.status}</Badge>
                          </TableCell>
                          <TableCell>
                            <Select value={editPayType} onValueChange={setEditPayType}>
                              <SelectTrigger className="w-32" data-testid="select-edit-pay-type">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="HOURLY">Hourly</SelectItem>
                                <SelectItem value="FIXED">Fixed Salary</SelectItem>
                                <SelectItem value="PER_TRIP">Per Trip</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2 items-center">
                              {editPayType === "HOURLY" && (
                                <div className="flex items-center gap-1">
                                  <span className="text-sm text-muted-foreground">$</span>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={editHourlyRate}
                                    onChange={(e) => setEditHourlyRate(e.target.value)}
                                    className="w-24"
                                    data-testid="input-edit-hourly-rate"
                                  />
                                  <span className="text-sm text-muted-foreground">/hr</span>
                                </div>
                              )}
                              {editPayType === "FIXED" && (
                                <div className="flex items-center gap-1">
                                  <span className="text-sm text-muted-foreground">$</span>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={editFixedSalary}
                                    onChange={(e) => setEditFixedSalary(e.target.value)}
                                    className="w-28"
                                    data-testid="input-edit-fixed-salary"
                                  />
                                  <Select value={editFixedPeriod} onValueChange={setEditFixedPeriod}>
                                    <SelectTrigger className="w-28" data-testid="select-edit-fixed-period">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="WEEKLY">Weekly</SelectItem>
                                      <SelectItem value="BIWEEKLY">Biweekly</SelectItem>
                                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              {editPayType === "PER_TRIP" && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="flex items-center gap-1">
                                    <span className="text-sm text-muted-foreground">$</span>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      placeholder="Flat"
                                      value={editPerTripFlat}
                                      onChange={(e) => setEditPerTripFlat(e.target.value)}
                                      className="w-20"
                                      data-testid="input-edit-trip-flat"
                                    />
                                    <span className="text-sm text-muted-foreground">/trip</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      placeholder="%"
                                      value={editPerTripPercent}
                                      onChange={(e) => setEditPerTripPercent(e.target.value)}
                                      className="w-20"
                                      data-testid="input-edit-trip-percent"
                                    />
                                    <span className="text-sm text-muted-foreground">%</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>-</TableCell>
                          <TableCell>
                            <Badge variant="outline">Custom</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                onClick={() => handleSave(row.driver.id)}
                                disabled={upsertMut.isPending}
                                data-testid={`button-save-pay-${row.driver.id}`}
                              >
                                {upsertMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} data-testid={`button-cancel-pay-${row.driver.id}`}>
                                Cancel
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }

                    return (
                      <TableRow key={row.driver.id} data-testid={`row-pay-config-${row.driver.id}`}>
                        <TableCell className="font-medium">
                          {row.driver.firstName} {row.driver.lastName}
                          {row.driver.email && <div className="text-xs text-muted-foreground">{row.driver.email}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.driver.status === "ACTIVE" ? "default" : "secondary"}>{row.driver.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" data-testid={`badge-pay-type-${row.driver.id}`}>{payTypeLabel(row.effectivePayType)}</Badge>
                        </TableCell>
                        <TableCell data-testid={`text-effective-rate-${row.driver.id}`}>
                          {renderEffectiveRate(row)}
                        </TableCell>
                        <TableCell data-testid={`cell-stripe-${row.driver.id}`}>
                          {(() => {
                            const ss = stripeStatuses[String(row.driver.id)];
                            if (!ss) return (
                              <Button size="sm" variant="outline" onClick={() => { setOnboardingDriverId(row.driver.id); onboardMut.mutate(row.driver.id); }}
                                disabled={onboardMut.isPending && onboardingDriverId === row.driver.id}
                                data-testid={`button-stripe-setup-${row.driver.id}`}>
                                {onboardMut.isPending && onboardingDriverId === row.driver.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <DollarSign className="h-3 w-3 mr-1" />}
                                Setup
                              </Button>
                            );
                            if (ss.status === "ACTIVE" && ss.payoutsEnabled) return <Badge variant="default" data-testid={`badge-stripe-status-${row.driver.id}`}>Active</Badge>;
                            if (ss.detailsSubmitted) return <Badge variant="secondary" data-testid={`badge-stripe-status-${row.driver.id}`}>Restricted</Badge>;
                            return (
                              <Button size="sm" variant="outline" onClick={() => { setOnboardingDriverId(row.driver.id); onboardMut.mutate(row.driver.id); }}
                                disabled={onboardMut.isPending && onboardingDriverId === row.driver.id}
                                data-testid={`button-stripe-continue-${row.driver.id}`}>
                                {onboardMut.isPending && onboardingDriverId === row.driver.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                Pending
                              </Button>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          {row.hasOverride ? (
                            <Badge variant="default" data-testid={`badge-source-${row.driver.id}`}>Custom</Badge>
                          ) : (
                            <Badge variant="secondary" data-testid={`badge-source-${row.driver.id}`}>Company Default</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => startEdit(row)} data-testid={`button-edit-pay-${row.driver.id}`}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            {row.hasOverride && row.payConfig && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteMut.mutate(row.payConfig.id)}
                                disabled={deleteMut.isPending}
                                title="Reset to company defaults"
                                data-testid={`button-reset-pay-${row.driver.id}`}
                              >
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateEntryDialog({ open, onClose, drivers, token }: { open: boolean; onClose: () => void; drivers: any[]; token: string | null }) {
  const { toast } = useToast();
  const [driverId, setDriverId] = useState("");
  const [workDate, setWorkDate] = useState(getToday());
  const [hours, setHours] = useState("8");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [breakMin, setBreakMin] = useState("0");
  const [rateCents, setRateCents] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!driverId || !workDate || !hours) {
      toast({ title: "Missing fields", description: "Driver, date, and hours are required", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await apiRequest("POST", "/api/company/time/manual-create", {
        driverId: parseInt(driverId),
        workDate,
        hoursNumeric: parseFloat(hours),
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        breakMinutes: parseInt(breakMin) || 0,
        hourlyRateCents: rateCents ? Math.round(parseFloat(rateCents) * 100) : undefined,
        notes,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
      toast({ title: "Time entry created" });
      onClose();
      setDriverId(""); setHours("8"); setNotes(""); setRateCents("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-create-entry">
        <DialogHeader><DialogTitle>New Time Entry</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Driver</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger data-testid="select-create-driver"><SelectValue placeholder="Select driver" /></SelectTrigger>
              <SelectContent>
                {drivers.map((d: any) => <SelectItem key={d.id} value={String(d.id)}>{d.firstName} {d.lastName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Work Date</Label>
            <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} data-testid="input-create-date" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Hours</Label><Input type="number" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} data-testid="input-create-hours" /></div>
            <div><Label>Rate ($/hr)</Label><Input type="number" step="0.01" value={rateCents} onChange={(e) => setRateCents(e.target.value)} placeholder="Optional" data-testid="input-create-rate" /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Start</Label><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
            <div><Label>End</Label><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
            <div><Label>Break (min)</Label><Input type="number" value={breakMin} onChange={(e) => setBreakMin(e.target.value)} /></div>
          </div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" data-testid="input-create-notes" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading} data-testid="button-save-entry">
            {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportCSVDialog({ open, onClose, token }: { open: boolean; onClose: () => void; token: string | null }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await rawAuthFetch("/api/company/time/import", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Import failed");
      }
      const data = await res.json();
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/time/import-batches"] });
      toast({ title: "Import complete", description: `Created ${data.created}, skipped ${data.skipped}` });
    } catch (e: any) {
      toast({ title: "Import Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setFile(null);
    setResult(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-import-csv">
        <DialogHeader><DialogTitle>Import CSV Timesheet</DialogTitle></DialogHeader>
        {!result ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Upload a CSV file with columns: driver_email, work_date (YYYY-MM-DD), hours. Optional: hourly_rate, notes, start_time, end_time, break_minutes.</p>
            <Input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="input-csv-file" />
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleUpload} disabled={!file || loading} data-testid="button-upload-csv">
                {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Upload
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3" data-testid="import-result">
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center p-3 rounded-md bg-muted"><div className="text-2xl font-bold">{result.created}</div><div className="text-sm text-muted-foreground">Created</div></div>
              <div className="text-center p-3 rounded-md bg-muted"><div className="text-2xl font-bold">{result.skipped}</div><div className="text-sm text-muted-foreground">Skipped</div></div>
            </div>
            {result.errors?.length > 0 && (
              <div className="max-h-40 overflow-y-auto text-xs text-destructive space-y-1">
                {result.errors.map((err: string, i: number) => <div key={i}>{err}</div>)}
              </div>
            )}
            <DialogFooter><Button onClick={handleClose}>Done</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditEntryDialog({ entry, onClose, token }: { entry: any; onClose: () => void; token: string | null }) {
  const { toast } = useToast();
  const [hours, setHours] = useState(String(parseFloat(entry.hoursNumeric)));
  const [notes, setNotes] = useState(entry.notes || "");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!reason.trim()) {
      toast({ title: "Edit reason is required", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await apiRequest("PATCH", `/api/company/time/${entry.id}/edit`, {
        hoursNumeric: parseFloat(hours),
        notes,
        editReason: reason,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
      toast({ title: "Entry updated" });
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-edit-entry">
        <DialogHeader><DialogTitle>Edit Time Entry</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Driver</Label><Input value={entry.driverName} disabled /></div>
          <div><Label>Date</Label><Input value={entry.workDate} disabled /></div>
          <div><Label>Hours</Label><Input type="number" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} data-testid="input-edit-hours" /></div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-edit-notes" /></div>
          <div><Label>Edit Reason (required)</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you editing?" data-testid="input-edit-reason" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading} data-testid="button-save-edit">
            {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
