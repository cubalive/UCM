import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CheckSquare, BarChart3, Play, Clock, DollarSign, AlertTriangle, Loader2 } from "lucide-react";

function fmt(cents: number) { return "$" + (cents / 100).toFixed(2); }

function DashboardTab() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const dashQuery = useQuery<any>({
    queryKey: ["/api/reconciliation/dashboard"],
    queryFn: () => apiFetch("/api/reconciliation/dashboard", token),
  });

  if (dashQuery.isLoading) return <Skeleton className="h-40 w-full" />;
  const d = dashQuery.data;
  if (!d) return <p className="text-muted-foreground">{t("reconciliation.noData")}</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("reconciliation.totalRuns")}</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold">{d.totalRuns || 0}</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("reconciliation.matched")}</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold text-emerald-400">{d.matchedCount || 0}</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("reconciliation.unmatched")}</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold text-red-400">{d.unmatchedCount || 0}</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("reconciliation.disputed")}</CardTitle></CardHeader>
        <CardContent><p className="text-2xl font-bold text-amber-400">{d.disputedCount || 0}</p></CardContent>
      </Card>
    </div>
  );
}

function RunsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split("T")[0];
  });
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().split("T")[0]);

  const runsQuery = useQuery<any>({
    queryKey: ["/api/reconciliation/runs"],
    queryFn: () => apiFetch("/api/reconciliation/runs", token),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reconciliation/run", { periodStart, periodEnd });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reconciliation"] });
      toast({ title: t("reconciliation.reconciliationComplete"), description: `Matched: ${data.matched || 0}, Unmatched: ${data.unmatched || 0}` });
    },
    onError: (err: any) => toast({ title: t("reconciliation.runFailed"), description: err.message, variant: "destructive" }),
  });

  const runs = runsQuery.data?.runs || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div><label className="text-xs text-muted-foreground">{t("reconciliation.periodStart")}</label><Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-40" /></div>
        <div><label className="text-xs text-muted-foreground">{t("reconciliation.periodEnd")}</label><Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-40" /></div>
        <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
          {runMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          {t("reconciliation.runReconciliation")}
        </Button>
      </div>

      {runsQuery.isLoading ? <Skeleton className="h-40 w-full" /> : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("reconciliation.runId")}</TableHead>
                <TableHead>{t("reconciliation.period")}</TableHead>
                <TableHead>{t("reconciliation.matched")}</TableHead>
                <TableHead>{t("reconciliation.unmatched")}</TableHead>
                <TableHead>{t("reconciliation.status")}</TableHead>
                <TableHead>{t("reconciliation.date")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{t("reconciliation.noRuns")}</TableCell></TableRow>
              ) : (
                runs.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                    <TableCell className="text-xs">{r.periodStart} — {r.periodEnd}</TableCell>
                    <TableCell className="text-emerald-400">{r.matchedCount || 0}</TableCell>
                    <TableCell className="text-red-400">{r.unmatchedCount || 0}</TableCell>
                    <TableCell><Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                    <TableCell className="text-xs">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function AgingTab() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const agingQuery = useQuery<any>({
    queryKey: ["/api/reconciliation/aging"],
    queryFn: () => apiFetch("/api/reconciliation/aging", token),
  });

  if (agingQuery.isLoading) return <Skeleton className="h-40 w-full" />;
  const buckets = agingQuery.data?.buckets || [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {buckets.map((b: any, i: number) => (
        <Card key={i}>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{b.label || `${b.minDays}-${b.maxDays} days`}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{b.count || 0} {t("reconciliation.items")}</p>
            <p className="text-sm text-muted-foreground">{fmt(b.totalCents || 0)}</p>
          </CardContent>
        </Card>
      ))}
      {buckets.length === 0 && <p className="text-muted-foreground col-span-4">{t("reconciliation.noAgingData")}</p>}
    </div>
  );
}

function WriteOffTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [invoiceId, setInvoiceId] = useState("");
  const [reason, setReason] = useState("");

  const writeOffMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/invoices/${invoiceId}/write-off`, { reason });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: t("reconciliation.invoiceWrittenOff"), description: `Invoice #${data.invoiceId} has been written off.` });
      setInvoiceId("");
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/reconciliation"] });
    },
    onError: (err: any) => toast({ title: t("reconciliation.writeOffFailed"), description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">{t("reconciliation.writeOffManagement")}</h3>
        <p className="text-sm text-muted-foreground">{t("reconciliation.writeOffDesc")}</p>
      </div>
      <Card>
        <CardContent className="py-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("reconciliation.invoiceId")}</label>
              <Input
                type="number"
                placeholder={t("reconciliation.enterInvoiceId")}
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                data-testid="input-writeoff-invoice-id"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("reconciliation.writeOffReason")}</label>
              <Input
                placeholder={t("reconciliation.reasonPlaceholder")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="input-writeoff-reason"
              />
            </div>
          </div>
          <Button
            onClick={() => writeOffMutation.mutate()}
            disabled={!invoiceId || !reason.trim() || writeOffMutation.isPending}
            data-testid="button-submit-writeoff"
          >
            {writeOffMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <AlertTriangle className="w-4 h-4 mr-2" />}
            {t("reconciliation.writeOffInvoice")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function AgedARTab() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const arQuery = useQuery<any>({
    queryKey: ["/api/billing/aged-ar"],
    queryFn: () => apiFetch("/api/billing/aged-ar", token),
    enabled: !!token,
  });

  if (arQuery.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!arQuery.data) return <p className="text-muted-foreground">{t("reconciliation.noData")}</p>;

  const { buckets, totalOutstanding, totalCount } = arQuery.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t("reconciliation.agedAccountsReceivable")}</h3>
          <p className="text-sm text-muted-foreground">{t("reconciliation.outstandingByBucket")}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{fmt(totalOutstanding)}</p>
          <p className="text-xs text-muted-foreground">{t("reconciliation.invoicesOutstanding", { count: totalCount })}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {(["0-30", "31-60", "61-90", "90+"] as const).map((bucket) => {
          const data = buckets[bucket];
          const colors: Record<string, string> = {
            "0-30": "text-emerald-500",
            "31-60": "text-amber-500",
            "61-90": "text-orange-500",
            "90+": "text-red-500",
          };
          return (
            <Card key={bucket}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">{bucket} {t("reconciliation.days")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-xl font-bold ${colors[bucket]}`} data-testid={`text-ar-${bucket}`}>
                  {fmt(data.totalCents)}
                </p>
                <p className="text-xs text-muted-foreground">{t("reconciliation.invoicesOutstanding", { count: data.count })}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {/* Invoices in worst bucket */}
      {buckets["90+"]?.invoices?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-red-500">{t("reconciliation.day90Outstanding")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reconciliation.invoiceNum")}</TableHead>
                  <TableHead>{t("reconciliation.patient")}</TableHead>
                  <TableHead>{t("reconciliation.serviceDate")}</TableHead>
                  <TableHead className="text-right">{t("reconciliation.amount")}</TableHead>
                  <TableHead className="text-right">{t("reconciliation.ageDays")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets["90+"].invoices.map((inv: any) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">#{inv.id}</TableCell>
                    <TableCell>{inv.patientName}</TableCell>
                    <TableCell>{inv.serviceDate}</TableCell>
                    <TableCell className="text-right">{fmt(inv.amount)}</TableCell>
                    <TableCell className="text-right text-red-500 font-medium">{inv.ageDays}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PaymentMethodsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  const pmQuery = useQuery<any>({
    queryKey: ["/api/billing/payment-methods"],
    queryFn: () => apiFetch("/api/billing/payment-methods", token),
    enabled: !!token,
  });

  const setDefaultMutation = useMutation({
    mutationFn: (pmId: string) =>
      apiFetch(`/api/billing/payment-methods/${pmId}/set-default`, token, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/payment-methods"] });
      toast({ title: t("reconciliation.defaultUpdated") });
    },
    onError: (err: any) => toast({ title: t("reconciliation.failed"), description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (pmId: string) =>
      apiFetch(`/api/billing/payment-methods/${pmId}`, token, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/payment-methods"] });
      toast({ title: t("reconciliation.paymentMethodRemoved") });
    },
    onError: (err: any) => toast({ title: t("reconciliation.failed"), description: err.message, variant: "destructive" }),
  });

  if (pmQuery.isLoading) return <Skeleton className="h-40 w-full" />;

  const methods = pmQuery.data?.paymentMethods || [];
  const brandIcons: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover" };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">{t("reconciliation.paymentMethods")}</h3>
        <p className="text-sm text-muted-foreground">{t("reconciliation.managePaymentMethods")}</p>
      </div>
      {methods.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>{t("reconciliation.noPaymentMethods")}</p>
            <p className="text-xs mt-1">{t("reconciliation.configureStripe")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {methods.map((pm: any) => (
            <Card key={pm.id}>
              <CardContent className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-7 rounded bg-muted flex items-center justify-center text-xs font-bold">
                    {brandIcons[pm.brand] || pm.brand}
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {pm.type === "card" ? `${(brandIcons[pm.brand] || pm.brand).toUpperCase()} ${t("reconciliation.endingIn")} ${pm.last4}` : pm.type}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("reconciliation.expires")} {pm.expMonth}/{pm.expYear}</p>
                  </div>
                  {pm.isDefault && <Badge variant="default" className="text-xs">{t("reconciliation.default")}</Badge>}
                </div>
                <div className="flex gap-2">
                  {!pm.isDefault && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDefaultMutation.mutate(pm.id)}
                      disabled={setDefaultMutation.isPending}
                      data-testid={`button-set-default-${pm.id}`}
                    >
                      {t("reconciliation.setDefault")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      if (window.confirm(t("reconciliation.removeConfirm"))) {
                        removeMutation.mutate(pm.id);
                      }
                    }}
                    disabled={removeMutation.isPending}
                    data-testid={`button-remove-${pm.id}`}
                  >
                    {t("reconciliation.remove")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReconciliationPage() {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <CheckSquare className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold">{t("reconciliation.title")}</h1>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList className="flex-wrap">
          <TabsTrigger value="dashboard"><BarChart3 className="w-4 h-4 mr-1" />{t("reconciliation.dashboard")}</TabsTrigger>
          <TabsTrigger value="runs"><Play className="w-4 h-4 mr-1" />{t("reconciliation.runs")}</TabsTrigger>
          <TabsTrigger value="aging"><Clock className="w-4 h-4 mr-1" />{t("reconciliation.agingReport")}</TabsTrigger>
          <TabsTrigger value="aged-ar" data-testid="tab-aged-ar"><DollarSign className="w-4 h-4 mr-1" />{t("reconciliation.agedAR")}</TabsTrigger>
          <TabsTrigger value="write-off" data-testid="tab-write-off"><AlertTriangle className="w-4 h-4 mr-1" />{t("reconciliation.writeOff")}</TabsTrigger>
          <TabsTrigger value="payment-methods" data-testid="tab-payment-methods"><DollarSign className="w-4 h-4 mr-1" />{t("reconciliation.paymentMethods")}</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4"><DashboardTab /></TabsContent>
        <TabsContent value="runs" className="mt-4"><RunsTab /></TabsContent>
        <TabsContent value="aging" className="mt-4"><AgingTab /></TabsContent>
        <TabsContent value="aged-ar" className="mt-4"><AgedARTab /></TabsContent>
        <TabsContent value="write-off" className="mt-4"><WriteOffTab /></TabsContent>
        <TabsContent value="payment-methods" className="mt-4"><PaymentMethodsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
