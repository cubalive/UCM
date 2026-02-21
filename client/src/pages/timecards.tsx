import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { apiFetch, rawAuthFetch } from "@/lib/api";
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
} from "lucide-react";

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
  const { token } = useAuth();
  const { toast } = useToast();
  const [from, setFrom] = useState(getMonthAgo());
  const [to, setTo] = useState(getToday());
  const [driverFilter, setDriverFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editEntry, setEditEntry] = useState<any>(null);

  const entriesQuery = useQuery({
    queryKey: ["/api/company/time/entries", from, to, driverFilter],
    queryFn: () => apiFetch(`/api/company/time/entries?from=${from}&to=${to}${driverFilter ? `&driver_id=${driverFilter}` : ""}`, token),
  });

  const driversQuery = useQuery({
    queryKey: ["/api/company/time/drivers"],
    queryFn: () => apiFetch("/api/company/time/drivers", token),
  });

  const batchesQuery = useQuery({
    queryKey: ["/api/company/time/import-batches"],
    queryFn: () => apiFetch("/api/company/time/import-batches?limit=10", token),
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

  const entries: any[] = entriesQuery.data || [];
  const driversList: any[] = driversQuery.data || [];

  const totalHours = entries.reduce((s, e) => s + (parseFloat(e.hoursNumeric) || 0), 0);
  const approvedCount = entries.filter((e) => e.status === "APPROVED").length;
  const pendingCount = entries.filter((e) => e.status === "DRAFT" || e.status === "SUBMITTED").length;

  return (
    <div className="p-4 space-y-4 max-w-[1400px] mx-auto" data-testid="timecards-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Timecards</h1>
        <div className="flex flex-wrap items-center gap-2">
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                      <TableCell><Badge variant="outline">{e.sourceType}</Badge></TableCell>
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
                    <TableCell>{new Date(b.createdAt).toLocaleDateString()}</TableCell>
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
