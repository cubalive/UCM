import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  FileText,
  BookOpen,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  Loader2,
  RefreshCw,
  Play,
  BarChart3,
} from "lucide-react";

function fmt(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

function fmtDate(date: string): string {
  return formatDate(date);
}

function DashboardTab() {
  const { toast } = useToast();

  const dashboardQuery = useQuery<{
    stats: {
      totalRevenueCents: number;
      outstandingARCents: number;
      platformFeesCollectedCents: number;
      overdueInvoiceCount: number;
    };
    recentInvoices: any[];
  }>({
    queryKey: ["/api/finance/dashboard"],
  });

  const dunningMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/finance/dunning/run");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/dashboard"] });
      toast({
        title: "Dunning run complete",
        description: `Attempted: ${data.attempted}, Succeeded: ${data.succeeded}, Failed: ${data.failed}`,
      });
    },
    onError: (err: any) =>
      toast({ title: "Dunning failed", description: err.message, variant: "destructive" }),
  });

  const stats = dashboardQuery.data?.stats;
  const recentInvoices = dashboardQuery.data?.recentInvoices || [];

  if (dashboardQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-revenue">
              {stats ? fmt(stats.totalRevenueCents) : "$0.00"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outstanding AR</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-outstanding-ar">
              {stats ? fmt(stats.outstandingARCents) : "$0.00"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Platform Fees</CardTitle>
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-platform-fees">
              {stats ? fmt(stats.platformFeesCollectedCents) : "$0.00"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overdue Invoices</CardTitle>
            <AlertCircle className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-overdue-invoices">
              {stats?.overdueInvoiceCount ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          onClick={() => dunningMutation.mutate()}
          disabled={dunningMutation.isPending}
          data-testid="button-run-dunning"
        >
          {dunningMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Play className="w-4 h-4 mr-2" />
          )}
          Run Dunning
        </Button>
        <Button
          variant="outline"
          onClick={() => dashboardQuery.refetch()}
          data-testid="button-refresh-dashboard"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">Recent Invoices</CardTitle>
          <FileText className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {recentInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-recent-invoices">
              No recent invoices found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentInvoices.map((inv: any, idx: number) => (
                    <TableRow key={inv.id || idx} data-testid={`row-recent-invoice-${inv.id || idx}`}>
                      <TableCell className="font-mono text-sm" data-testid={`text-invoice-number-${inv.id || idx}`}>
                        {inv.invoiceNumber || `#${inv.id}`}
                      </TableCell>
                      <TableCell className="text-sm">{inv.companyName || inv.company_id || "-"}</TableCell>
                      <TableCell className="text-sm">{inv.clinicName || inv.clinic_id || "-"}</TableCell>
                      <TableCell className="font-medium text-sm" data-testid={`text-invoice-amount-${inv.id || idx}`}>
                        {fmt(inv.totalCents || inv.total_cents || 0)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={inv.status === "paid" ? "default" : inv.status === "overdue" ? "destructive" : "secondary"}
                          data-testid={`badge-invoice-status-${inv.id || idx}`}
                        >
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {inv.createdAt ? fmtDate(inv.createdAt) : inv.created_at ? fmtDate(inv.created_at) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LedgerTab() {
  const [companyId, setCompanyId] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [account, setAccount] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showSummary, setShowSummary] = useState(false);

  function buildLedgerUrl() {
    const p = new URLSearchParams();
    if (companyId) p.set("company_id", companyId);
    if (clinicId) p.set("clinic_id", clinicId);
    if (account && account !== "__all__") p.set("account", account);
    if (fromDate) p.set("from", fromDate);
    if (toDate) p.set("to", toDate);
    p.set("limit", "100");
    return `/api/finance/ledger?${p.toString()}`;
  }

  function buildSummaryUrl() {
    const p = new URLSearchParams();
    if (companyId) p.set("company_id", companyId);
    if (fromDate) p.set("from", fromDate);
    if (toDate) p.set("to", toDate);
    return `/api/finance/ledger/summary?${p.toString()}`;
  }

  const ledgerQuery = useQuery<{ entries: any[] }>({
    queryKey: [buildLedgerUrl()],
  });

  const summaryQuery = useQuery<{ summary: any[] }>({
    queryKey: [buildSummaryUrl()],
    enabled: showSummary,
  });

  const entries = ledgerQuery.data?.entries || [];
  const summaryData = summaryQuery.data?.summary || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Input
              placeholder="Company ID"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              data-testid="input-ledger-company"
            />
            <Input
              placeholder="Clinic ID"
              value={clinicId}
              onChange={(e) => setClinicId(e.target.value)}
              data-testid="input-ledger-clinic"
            />
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger data-testid="select-ledger-account">
                <SelectValue placeholder="Account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Accounts</SelectItem>
                <SelectItem value="accounts_receivable">Accounts Receivable</SelectItem>
                <SelectItem value="revenue">Revenue</SelectItem>
                <SelectItem value="platform_fee">Platform Fee</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              data-testid="input-ledger-from"
            />
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              data-testid="input-ledger-to"
            />
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Button
              variant="outline"
              onClick={() => setShowSummary(!showSummary)}
              data-testid="button-toggle-summary"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              {showSummary ? "Hide Summary" : "Show Summary"}
            </Button>
            <Button
              variant="outline"
              onClick={() => ledgerQuery.refetch()}
              data-testid="button-refresh-ledger"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {showSummary && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">Ledger Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : summaryData.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-summary">No summary data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaryData.map((s: any, idx: number) => (
                      <TableRow key={idx} data-testid={`row-summary-${idx}`}>
                        <TableCell className="font-medium text-sm">{s.account}</TableCell>
                        <TableCell>
                          <Badge variant={s.direction === "debit" ? "secondary" : "default"} data-testid={`badge-summary-direction-${idx}`}>
                            {s.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-sm" data-testid={`text-summary-total-${idx}`}>
                          {fmt(s.total)}
                        </TableCell>
                        <TableCell className="text-sm">{s.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">Ledger Entries</CardTitle>
          <BookOpen className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {ledgerQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-ledger-entries">No ledger entries found.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry: any, idx: number) => (
                    <TableRow key={entry.id || idx} data-testid={`row-ledger-${entry.id || idx}`}>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.createdAt ? fmtDate(entry.createdAt) : entry.created_at ? fmtDate(entry.created_at) : "-"}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{entry.account}</TableCell>
                      <TableCell>
                        <Badge variant={entry.direction === "debit" ? "secondary" : "default"}>
                          {entry.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-sm" data-testid={`text-ledger-amount-${entry.id || idx}`}>
                        {fmt(entry.amountCents || entry.amount_cents || 0)}
                      </TableCell>
                      <TableCell className="text-sm font-mono">{entry.referenceType}:{entry.referenceId || entry.reference_id}</TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{entry.description || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AuditTab() {
  const [companyId, setCompanyId] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  function buildAuditUrl() {
    const p = new URLSearchParams();
    if (companyId) p.set("company_id", companyId);
    if (action && action !== "__all__") p.set("action", action);
    if (entityType && entityType !== "__all__") p.set("entity_type", entityType);
    if (fromDate) p.set("from", fromDate);
    if (toDate) p.set("to", toDate);
    p.set("limit", "100");
    return `/api/finance/audit?${p.toString()}`;
  }

  const auditQuery = useQuery<{ events: any[] }>({
    queryKey: [buildAuditUrl()],
  });

  const events = auditQuery.data?.events || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Input
              placeholder="Company ID"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              data-testid="input-audit-company"
            />
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger data-testid="select-audit-action">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Actions</SelectItem>
                <SelectItem value="invoice_created">Invoice Created</SelectItem>
                <SelectItem value="invoice_paid">Invoice Paid</SelectItem>
                <SelectItem value="invoice_voided">Invoice Voided</SelectItem>
                <SelectItem value="payment_received">Payment Received</SelectItem>
                <SelectItem value="dunning_sent">Dunning Sent</SelectItem>
                <SelectItem value="fee_collected">Fee Collected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger data-testid="select-audit-entity-type">
                <SelectValue placeholder="Entity Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Types</SelectItem>
                <SelectItem value="invoice">Invoice</SelectItem>
                <SelectItem value="payment">Payment</SelectItem>
                <SelectItem value="ledger_entry">Ledger Entry</SelectItem>
                <SelectItem value="platform_fee">Platform Fee</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              data-testid="input-audit-from"
            />
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              data-testid="input-audit-to"
            />
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Button
              variant="outline"
              onClick={() => auditQuery.refetch()}
              data-testid="button-refresh-audit"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">Billing Audit Events</CardTitle>
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {auditQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-audit-events">No audit events found.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity Type</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((evt: any, idx: number) => (
                    <TableRow key={evt.id || idx} data-testid={`row-audit-${evt.id || idx}`}>
                      <TableCell className="text-sm text-muted-foreground">
                        {evt.createdAt ? fmtDate(evt.createdAt) : evt.created_at ? fmtDate(evt.created_at) : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" data-testid={`badge-audit-action-${evt.id || idx}`}>
                          {evt.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{evt.entityType || evt.entity_type || "-"}</TableCell>
                      <TableCell className="text-sm font-mono">{evt.entityId || evt.entity_id || "-"}</TableCell>
                      <TableCell className="text-sm">{evt.actorEmail || evt.actor_email || evt.actorId || evt.actor_id || "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
                        {evt.details ? (typeof evt.details === "string" ? evt.details : JSON.stringify(evt.details)) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function FinanceConsolePage() {
  return (
    <div className="p-4 space-y-6 max-w-7xl mx-auto" data-testid="finance-console-page">
      <div className="flex items-center gap-3 flex-wrap">
        <DollarSign className="w-6 h-6" />
        <h1 className="text-2xl font-bold" data-testid="text-finance-console-title">
          Enterprise Finance Console
        </h1>
      </div>

      <Tabs defaultValue="dashboard" data-testid="tabs-finance-console">
        <TabsList data-testid="tabslist-finance-console">
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">
            <DollarSign className="w-4 h-4 mr-1.5" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="ledger" data-testid="tab-ledger">
            <BookOpen className="w-4 h-4 mr-1.5" />
            Ledger
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            <ShieldCheck className="w-4 h-4 mr-1.5" />
            Audit Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab />
        </TabsContent>
        <TabsContent value="ledger" className="mt-4">
          <LedgerTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
