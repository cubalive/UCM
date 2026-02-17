import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  DollarSign,
  FileCheck,
  CreditCard,
  Loader2,
  Plus,
  Eye,
} from "lucide-react";

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}
function getMonthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().split("T")[0];
}

function runStatusVariant(status: string) {
  switch (status) {
    case "PAID": return "default" as const;
    case "FINALIZED": return "secondary" as const;
    default: return "outline" as const;
  }
}

export default function TpPayrollPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedRun, setSelectedRun] = useState<number | null>(null);

  const runsQuery = useQuery({
    queryKey: ["/api/company/payroll/runs"],
    queryFn: () => apiFetch("/api/company/payroll/runs", token),
  });

  const runs: any[] = runsQuery.data || [];

  const finalizeMut = useMutation({
    mutationFn: (runId: number) => apiRequest("POST", `/api/company/payroll/${runId}/finalize`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/payroll/runs"] });
      toast({ title: "Payroll run finalized" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const payMut = useMutation({
    mutationFn: (runId: number) => apiRequest("POST", `/api/company/payroll/${runId}/pay`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/payroll/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
      toast({ title: "Payroll marked as paid" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalRuns = runs.length;
  const paidRuns = runs.filter((r) => r.status === "PAID").length;

  return (
    <div className="p-4 space-y-4 max-w-[1400px] mx-auto" data-testid="payroll-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-payroll-title">Time & Pay - Payroll</h1>
        <Button onClick={() => setShowGenerate(true)} data-testid="button-generate-payroll">
          <Plus className="mr-1 h-4 w-4" /> Generate Payroll Run
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Runs</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid="text-total-runs">{totalRuns}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Paid</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid="text-paid-runs">{paidRuns}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Payroll Runs</CardTitle></CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : runs.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-runs">No payroll runs yet. Generate one from approved time entries.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r: any) => (
                  <TableRow key={r.id} data-testid={`row-payroll-run-${r.id}`}>
                    <TableCell>#{r.id}</TableCell>
                    <TableCell>{r.periodStart} to {r.periodEnd}</TableCell>
                    <TableCell><Badge variant={runStatusVariant(r.status)} data-testid={`badge-run-status-${r.id}`}>{r.status}</Badge></TableCell>
                    <TableCell>{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedRun(r.id)} data-testid={`button-view-run-${r.id}`}>
                          <Eye className="h-3 w-3 mr-1" /> View
                        </Button>
                        {r.status === "DRAFT" && (
                          <Button size="sm" variant="outline" onClick={() => finalizeMut.mutate(r.id)} disabled={finalizeMut.isPending} data-testid={`button-finalize-${r.id}`}>
                            <FileCheck className="h-3 w-3 mr-1" /> Finalize
                          </Button>
                        )}
                        {r.status === "FINALIZED" && (
                          <Button size="sm" onClick={() => payMut.mutate(r.id)} disabled={payMut.isPending} data-testid={`button-pay-${r.id}`}>
                            <CreditCard className="h-3 w-3 mr-1" /> Mark Paid
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <GenerateDialog open={showGenerate} onClose={() => setShowGenerate(false)} />
      {selectedRun && <RunDetailDialog runId={selectedRun} onClose={() => setSelectedRun(null)} />}
    </div>
  );
}

function GenerateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [start, setStart] = useState(getMonthAgo());
  const [end, setEnd] = useState(getToday());
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/company/payroll/generate?periodStart=${start}&periodEnd=${end}`);
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/company/payroll/runs"] });
      toast({ title: "Payroll run generated", description: `${data.items?.length || 0} drivers, ${data.missingRateEntries || 0} entries skipped (no rate)` });
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-generate-payroll">
        <DialogHeader><DialogTitle>Generate Payroll Run</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">This will gather all APPROVED time entries in the selected period and compute totals per driver.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Period Start</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="input-period-start" /></div>
          <div><Label>Period End</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="input-period-end" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleGenerate} disabled={loading} data-testid="button-confirm-generate">
            {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunDetailDialog({ runId, onClose }: { runId: number; onClose: () => void }) {
  const { token } = useAuth();

  const detailQuery = useQuery({
    queryKey: ["/api/company/payroll/runs", runId],
    queryFn: () => apiFetch(`/api/company/payroll/runs/${runId}`, token),
  });

  const data = detailQuery.data as any;
  const run = data?.run;
  const items: any[] = data?.items || [];

  const totalCents = items.reduce((s, i) => s + (i.totalCents || 0), 0);
  const totalHours = items.reduce((s, i) => s + (parseFloat(i.totalHours) || 0), 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-run-detail">
        <DialogHeader><DialogTitle>Payroll Run #{runId}</DialogTitle></DialogHeader>
        {detailQuery.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        ) : !run ? (
          <p className="text-muted-foreground">Run not found</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <div><span className="text-muted-foreground">Period:</span> {run.periodStart} to {run.periodEnd}</div>
              <div><span className="text-muted-foreground">Status:</span> <Badge variant={runStatusVariant(run.status)}>{run.status}</Badge></div>
              <div><span className="text-muted-foreground">Total:</span> <span className="font-bold">${(totalCents / 100).toFixed(2)}</span></div>
              <div><span className="text-muted-foreground">Hours:</span> {totalHours.toFixed(1)}</div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Driver</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any) => (
                  <TableRow key={item.id} data-testid={`row-payroll-item-${item.id}`}>
                    <TableCell className="font-medium">{item.driverName}</TableCell>
                    <TableCell>{parseFloat(item.totalHours).toFixed(1)}</TableCell>
                    <TableCell>${(item.totalCents / 100).toFixed(2)}</TableCell>
                    <TableCell><Badge variant={item.status === "PAID" ? "default" : "outline"}>{item.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
