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
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign,
  FileCheck,
  CreditCard,
  Loader2,
  Plus,
  Eye,
  Trash2,
  Users,
  Send,
  AlertTriangle,
  CheckCircle2,
  XCircle,
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

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function TpPayrollPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [deleteRunId, setDeleteRunId] = useState<number | null>(null);

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

  const deleteMut = useMutation({
    mutationFn: (runId: number) => apiRequest("DELETE", `/api/company/payroll/${runId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/payroll/runs"] });
      toast({ title: "Draft payroll run deleted" });
      setDeleteRunId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalRuns = runs.length;
  const paidRuns = runs.filter((r) => r.status === "PAID").length;
  const totalAmount = runs.reduce((s: number, r: any) => s + (r.totalCents || 0), 0);
  const totalDrivers = runs.reduce((s: number, r: any) => s + (r.driverCount || 0), 0);

  return (
    <div className="p-4 space-y-4 max-w-[1400px] mx-auto" data-testid="payroll-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-payroll-title">Time & Pay - Payroll</h1>
        <Button onClick={() => setShowGenerate(true)} data-testid="button-generate-payroll">
          <Plus className="mr-1 h-4 w-4" /> Generate Payroll Run
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid="text-total-amount">{formatCurrency(totalAmount)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Drivers Paid</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid="text-total-drivers">{totalDrivers}</div></CardContent>
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
                  <TableHead>Drivers</TableHead>
                  <TableHead>Amount</TableHead>
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
                    <TableCell>{r.driverCount || 0}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(r.totalCents || 0)}</TableCell>
                    <TableCell><Badge variant={runStatusVariant(r.status)} data-testid={`badge-run-status-${r.id}`}>{r.status}</Badge></TableCell>
                    <TableCell>{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedRun(r.id)} data-testid={`button-view-run-${r.id}`}>
                          <Eye className="h-3 w-3 mr-1" /> View
                        </Button>
                        {r.status === "DRAFT" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => finalizeMut.mutate(r.id)} disabled={finalizeMut.isPending} data-testid={`button-finalize-${r.id}`}>
                              <FileCheck className="h-3 w-3 mr-1" /> Finalize
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteRunId(r.id)} data-testid={`button-delete-${r.id}`}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
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

      <AlertDialog open={deleteRunId !== null} onOpenChange={(o) => !o && setDeleteRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Draft Payroll Run</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this draft payroll run? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteRunId && deleteMut.mutate(deleteRunId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
        <DialogDescription>This will gather all APPROVED time entries in the selected period and compute totals per driver. One entry per driver will be created.</DialogDescription>
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
  const { toast } = useToast();
  const [showPayConfirm, setShowPayConfirm] = useState(false);
  const [payResult, setPayResult] = useState<any>(null);

  const detailQuery = useQuery({
    queryKey: ["/api/company/payroll/runs", runId],
    queryFn: () => apiFetch(`/api/company/payroll/runs/${runId}`, token),
  });

  const payMut = useMutation({
    mutationFn: (rId: number) => apiRequest("POST", `/api/company/payroll/${rId}/pay`),
    onSuccess: async (res) => {
      const data = await res.json();
      setPayResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/company/payroll/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/payroll/runs", runId] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
      toast({ title: "Payment processed", description: data.note || "Payroll paid successfully" });
      setShowPayConfirm(false);
    },
    onError: (e: any) => {
      toast({ title: "Payment failed", description: e.message, variant: "destructive" });
      setShowPayConfirm(false);
    },
  });

  const payItemMut = useMutation({
    mutationFn: ({ rId, itemId }: { rId: number; itemId: number }) =>
      apiRequest("POST", `/api/company/payroll/${rId}/items/${itemId}/pay`),
    onSuccess: async (res) => {
      const data = await res.json();
      if (data.alreadyPaid) {
        toast({ title: "Already paid", description: "This driver has already been paid." });
      } else {
        const t = data.transfer;
        if (t?.status === "transferred") {
          toast({ title: "Payment sent", description: `$${(t.amountCents / 100).toFixed(2)} transferred to driver` });
        } else if (t?.status === "manual") {
          toast({ title: "Marked as paid", description: `$${(t.amountCents / 100).toFixed(2)} marked for manual payment` });
        } else {
          toast({ title: "Payment issue", description: t?.error || "Transfer could not be completed", variant: "destructive" });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/company/payroll/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/payroll/runs", runId] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/time/entries"] });
    },
    onError: (e: any) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  const finalizeMut = useMutation({
    mutationFn: (rId: number) => apiRequest("POST", `/api/company/payroll/${rId}/finalize`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/payroll/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/payroll/runs", runId] });
      toast({ title: "Payroll run finalized" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const data = detailQuery.data as any;
  const run = data?.run;
  const items: any[] = data?.items || [];
  const stripeConfigured = data?.stripeConfigured || false;

  const totalCents = items.reduce((s: number, i: any) => s + (i.totalCents || 0), 0);
  const totalHours = items.reduce((s: number, i: any) => s + (parseFloat(i.totalHours) || 0), 0);

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="dialog-run-detail">
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
                <div><span className="text-muted-foreground">Total:</span> <span className="font-bold">{formatCurrency(totalCents)}</span></div>
                <div><span className="text-muted-foreground">Hours:</span> {totalHours.toFixed(1)}</div>
                <div><span className="text-muted-foreground">Drivers:</span> {items.length}</div>
              </div>

              {run.status === "DRAFT" && (
                <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                  <p className="text-sm text-muted-foreground">This run is in DRAFT status. Finalize it first to enable payment.</p>
                  <Button size="sm" className="ml-auto" onClick={() => finalizeMut.mutate(runId)} disabled={finalizeMut.isPending} data-testid="button-finalize-detail">
                    <FileCheck className="h-3 w-3 mr-1" /> Finalize
                  </Button>
                </div>
              )}

              {run.status === "FINALIZED" && (
                <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <Send className="h-4 w-4 text-emerald-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Ready to Pay</p>
                    <p className="text-xs text-muted-foreground">
                      {stripeConfigured
                        ? "Stripe is configured. Clicking pay will transfer funds to each driver's Stripe Connect account."
                        : "Stripe is not configured. Clicking pay will mark this run as paid for manual processing."}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setShowPayConfirm(true)} disabled={payMut.isPending} data-testid="button-pay-stripe">
                    <CreditCard className="h-3 w-3 mr-1" />
                    {stripeConfigured ? "Pay via Stripe" : "Mark as Paid"}
                  </Button>
                </div>
              )}

              {payResult && payResult.transfers && (
                <div className="p-3 border rounded-lg space-y-2">
                  <h4 className="text-sm font-semibold">Transfer Results</h4>
                  {payResult.transfers.map((t: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      {t.status === "transferred" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      ) : t.status === "manual" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-500" />
                      )}
                      <span>Driver #{t.driverId}</span>
                      <span className="font-medium">{formatCurrency(t.amountCents)}</span>
                      <Badge variant={t.status === "transferred" || t.status === "manual" ? "default" : "destructive"} className="text-[10px]">
                        {t.status === "transferred" ? "Sent" : t.status === "manual" ? "Manual" : t.status === "no_stripe" ? "No Stripe" : "Failed"}
                      </Badge>
                      {t.transferId && <span className="text-muted-foreground font-mono">{t.transferId}</span>}
                      {t.error && <span className="text-destructive">{t.error}</span>}
                    </div>
                  ))}
                </div>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Stripe</TableHead>
                    <TableHead>Status</TableHead>
                    {(run.status === "FINALIZED" || run.status === "PAID") && <TableHead className="text-right">Action</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: any) => (
                    <TableRow key={item.id} data-testid={`row-payroll-item-${item.id}`}>
                      <TableCell className="font-mono text-xs" data-testid={`text-user-id-${item.id}`}>
                        {item.driverUserId ? `#${item.driverUserId}` : <span className="text-muted-foreground">N/A</span>}
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-driver-name-${item.id}`}>{item.driverName}</TableCell>
                      <TableCell>{parseFloat(item.totalHours).toFixed(1)}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(item.totalCents)}</TableCell>
                      <TableCell>
                        {item.stripePayoutsEnabled ? (
                          <Badge variant="default" className="text-[10px]" data-testid={`badge-stripe-${item.id}`}>Active</Badge>
                        ) : item.stripeStatus ? (
                          <Badge variant="secondary" className="text-[10px]" data-testid={`badge-stripe-${item.id}`}>{item.stripeStatus}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]" data-testid={`badge-stripe-${item.id}`}>Not Set</Badge>
                        )}
                      </TableCell>
                      <TableCell><Badge variant={item.status === "PAID" ? "default" : "outline"} data-testid={`badge-item-status-${item.id}`}>{item.status}</Badge></TableCell>
                      {(run.status === "FINALIZED" || run.status === "PAID") && (
                        <TableCell className="text-right">
                          {item.status === "PAID" ? (
                            <Badge variant="default" className="text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" />Paid</Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => payItemMut.mutate({ rId: runId, itemId: item.id })}
                              disabled={payItemMut.isPending}
                              data-testid={`button-pay-driver-${item.id}`}
                            >
                              {payItemMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <DollarSign className="h-3 w-3 mr-1" />}
                              Pay
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showPayConfirm} onOpenChange={(o) => !o && setShowPayConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {stripeConfigured ? "Pay Drivers via Stripe" : "Mark Payroll as Paid"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {stripeConfigured
                ? `This will transfer ${formatCurrency(totalCents)} to ${items.length} driver(s) via Stripe Connect. Funds will be sent directly to each driver's connected Stripe account. This action cannot be reversed.`
                : `This will mark the payroll run as PAID for ${items.length} driver(s) totaling ${formatCurrency(totalCents)}. No actual transfer will be made since Stripe is not configured.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => payMut.mutate(runId)}
              disabled={payMut.isPending}
              data-testid="button-confirm-pay"
            >
              {payMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CreditCard className="h-4 w-4 mr-1" />}
              {stripeConfigured ? "Confirm & Pay" : "Mark as Paid"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
