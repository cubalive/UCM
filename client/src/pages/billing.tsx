import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Building2,
  Plus,
  Eye,
  Loader2,
  CheckCircle,
  Copy,
  RefreshCw,
  Lock,
  ExternalLink,
} from "lucide-react";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getMonthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().split("T")[0];
}

function statusBadgeVariant(status: string) {
  switch (status) {
    case "draft":
      return "outline" as const;
    case "finalized":
      return "secondary" as const;
    case "void":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function paymentBadgeVariant(status: string) {
  switch (status) {
    case "paid":
      return "default" as const;
    case "partial":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export default function BillingPage() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [genMode, setGenMode] = useState<string>("single");
  const [genClinicId, setGenClinicId] = useState<string>("");
  const [genStart, setGenStart] = useState(getMonthAgo());
  const [genEnd, setGenEnd] = useState(getToday());

  const [filterClinicId, setFilterClinicId] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPayment, setFilterPayment] = useState<string>("all");

  const [detailInvoice, setDetailInvoice] = useState<any | null>(null);

  const clinicsQuery = useQuery<any[]>({
    queryKey: ["/api/clinics"],
    queryFn: () => apiFetch("/api/clinics", token),
    enabled: !!token,
  });

  const invoicesQuery = useQuery<any[]>({
    queryKey: ["/api/company/billing/invoices"],
    queryFn: () => apiFetch("/api/company/billing/invoices", token),
    enabled: !!token,
  });

  const backfillMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/company/billing/backfill?from=${genStart}&to=${genEnd}`, token, {
        method: "POST",
      }),
    onSuccess: (data: any) => {
      toast({
        title: "Backfill complete",
        description: `Processed ${data.processed} trips, ${data.errors} errors out of ${data.total} total.`,
      });
    },
    onError: (err: any) =>
      toast({ title: "Backfill error", description: err.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/company/billing/invoices/generate", token, {
        method: "POST",
        body: JSON.stringify({
          clinicId: parseInt(genClinicId),
          periodStart: genStart,
          periodEnd: genEnd,
        }),
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/billing/invoices"] });
      toast({
        title: "Invoice generated",
        description: `Invoice ${data.invoiceNumber || `#${data.id}`} created — ${formatCents(data.totalCents)}`,
      });
    },
    onError: (err: any) =>
      toast({ title: "Generation error", description: err.message, variant: "destructive" }),
  });

  const batchGenerateMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/company/billing/invoices/batch-generate", token, {
        method: "POST",
        body: JSON.stringify({ periodStart: genStart, periodEnd: genEnd }),
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/billing/invoices"] });
      toast({
        title: "Batch generation complete",
        description: `Generated ${data.generated?.length || 0} invoices, skipped ${data.skipped?.length || 0}, ${data.errors?.length || 0} errors.`,
      });
    },
    onError: (err: any) =>
      toast({ title: "Batch error", description: err.message, variant: "destructive" }),
  });

  const finalizeMutation = useMutation({
    mutationFn: (invoiceId: number) =>
      apiFetch(`/api/company/billing/invoices/${invoiceId}/finalize`, token, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/billing/invoices"] });
      toast({ title: "Invoice finalized" });
    },
    onError: (err: any) =>
      toast({ title: "Finalize error", description: err.message, variant: "destructive" }),
  });

  const batchFinalizeMutation = useMutation({
    mutationFn: () => {
      const body: any = {};
      if (filterClinicId !== "all") body.clinicId = parseInt(filterClinicId);
      return apiFetch("/api/company/billing/invoices/batch-finalize", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/billing/invoices"] });
      toast({
        title: "Batch finalize complete",
        description: `Finalized ${data.finalized || 0} invoices.`,
      });
    },
    onError: (err: any) =>
      toast({ title: "Batch finalize error", description: err.message, variant: "destructive" }),
  });

  const clinics = clinicsQuery.data || [];
  const allInvoices = invoicesQuery.data || [];

  const filteredInvoices = allInvoices.filter((inv: any) => {
    if (filterClinicId !== "all" && String(inv.clinicId) !== filterClinicId) return false;
    if (filterStatus !== "all" && inv.status !== filterStatus) return false;
    if (filterPayment !== "all" && (inv.paymentStatus || "unpaid") !== filterPayment) return false;
    return true;
  });

  const draftCount = allInvoices.filter((inv: any) => inv.status === "draft").length;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="p-4 space-y-6 max-w-6xl mx-auto">
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <FileText className="w-6 h-6" />
          <h1 className="text-xl font-semibold" data-testid="text-billing-title">
            Billing & Invoices
          </h1>
        </div>
        <p className="text-sm text-muted-foreground" data-testid="text-billing-subtitle">
          Unified billing view — generate, finalize, and track invoices for all clinics.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="w-4 h-4" />
            Generate Invoices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={genMode} onValueChange={setGenMode}>
            <TabsList data-testid="tabs-gen-mode">
              <TabsTrigger value="single" data-testid="tab-single-clinic">
                Single Clinic
              </TabsTrigger>
              <TabsTrigger value="batch" data-testid="tab-batch">
                All Clinics (Batch)
              </TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Clinic</Label>
                  <Select value={genClinicId} onValueChange={setGenClinicId}>
                    <SelectTrigger data-testid="select-gen-clinic">
                      <SelectValue placeholder="Select clinic" />
                    </SelectTrigger>
                    <SelectContent>
                      {clinics.map((c: any) => (
                        <SelectItem
                          key={c.id}
                          value={String(c.id)}
                          data-testid={`option-gen-clinic-${c.id}`}
                        >
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Period Start</Label>
                  <Input
                    type="date"
                    value={genStart}
                    onChange={(e) => setGenStart(e.target.value)}
                    data-testid="input-gen-start"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Period End</Label>
                  <Input
                    type="date"
                    value={genEnd}
                    onChange={(e) => setGenEnd(e.target.value)}
                    data-testid="input-gen-end"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={!genClinicId || !genStart || !genEnd || generateMutation.isPending}
                  data-testid="button-generate-single"
                  className="gap-1.5"
                >
                  {generateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  {generateMutation.isPending ? "Generating..." : "Generate Invoice"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => backfillMutation.mutate()}
                  disabled={!genStart || !genEnd || backfillMutation.isPending}
                  data-testid="button-backfill"
                  className="gap-1.5"
                >
                  {backfillMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {backfillMutation.isPending ? "Backfilling..." : "Backfill Trip Data"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="batch" className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Period Start</Label>
                  <Input
                    type="date"
                    value={genStart}
                    onChange={(e) => setGenStart(e.target.value)}
                    data-testid="input-batch-start"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Period End</Label>
                  <Input
                    type="date"
                    value={genEnd}
                    onChange={(e) => setGenEnd(e.target.value)}
                    data-testid="input-batch-end"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={() => batchGenerateMutation.mutate()}
                  disabled={!genStart || !genEnd || batchGenerateMutation.isPending}
                  data-testid="button-generate-batch"
                  className="gap-1.5"
                >
                  {batchGenerateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  {batchGenerateMutation.isPending ? "Generating..." : "Generate All"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => backfillMutation.mutate()}
                  disabled={!genStart || !genEnd || backfillMutation.isPending}
                  data-testid="button-backfill-batch"
                  className="gap-1.5"
                >
                  {backfillMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {backfillMutation.isPending ? "Backfilling..." : "Backfill Trip Data"}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="w-4 h-4" />
            Invoices
          </CardTitle>
          {draftCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => batchFinalizeMutation.mutate()}
              disabled={batchFinalizeMutation.isPending}
              data-testid="button-finalize-all-drafts"
              className="gap-1.5"
            >
              {batchFinalizeMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
              Finalize All Drafts ({draftCount})
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Clinic</Label>
              <Select value={filterClinicId} onValueChange={setFilterClinicId}>
                <SelectTrigger className="w-[180px]" data-testid="select-filter-clinic">
                  <SelectValue placeholder="All Clinics" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Clinics</SelectItem>
                  {clinics.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[140px]" data-testid="select-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="finalized">Finalized</SelectItem>
                  <SelectItem value="void">Void</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Payment</Label>
              <Select value={filterPayment} onValueChange={setFilterPayment}>
                <SelectTrigger className="w-[140px]" data-testid="select-filter-payment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {invoicesQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filteredInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4" data-testid="text-no-invoices">
              No invoices found matching the current filters.
            </p>
          ) : (
            <div className="overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((inv: any) => (
                    <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                      <TableCell
                        className="font-mono text-sm"
                        data-testid={`text-inv-number-${inv.id}`}
                      >
                        {inv.invoiceNumber || `#${inv.id}`}
                      </TableCell>
                      <TableCell data-testid={`text-inv-clinic-${inv.id}`}>
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-sm">{inv.clinicName}</span>
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-sm"
                        data-testid={`text-inv-period-${inv.id}`}
                      >
                        {inv.periodStart} — {inv.periodEnd}
                      </TableCell>
                      <TableCell
                        className="font-medium"
                        data-testid={`text-inv-amount-${inv.id}`}
                      >
                        {formatCents(inv.totalCents || 0)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusBadgeVariant(inv.status)}
                          data-testid={`badge-inv-status-${inv.id}`}
                        >
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={paymentBadgeVariant(inv.paymentStatus || "unpaid")}
                          data-testid={`badge-inv-payment-${inv.id}`}
                        >
                          {inv.paymentStatus || "unpaid"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm" data-testid={`text-inv-due-${inv.id}`}>
                        {inv.dueDate
                          ? formatDate(inv.dueDate)
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDetailInvoice(inv)}
                            data-testid={`button-view-invoice-${inv.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {inv.status === "draft" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => finalizeMutation.mutate(inv.id)}
                              disabled={finalizeMutation.isPending}
                              data-testid={`button-finalize-${inv.id}`}
                              className="gap-1"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Finalize
                            </Button>
                          )}
                          {inv.status === "finalized" && inv.stripeCheckoutUrl && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => copyToClipboard(inv.stripeCheckoutUrl)}
                              data-testid={`button-copy-url-${inv.id}`}
                            >
                              <Copy className="w-4 h-4" />
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

      <Dialog
        open={detailInvoice !== null}
        onOpenChange={(open) => !open && setDetailInvoice(null)}
      >
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Invoice Details
            </DialogTitle>
          </DialogHeader>
          {detailInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Invoice #:</span>{" "}
                  <span className="font-medium" data-testid="text-detail-inv-number">
                    {detailInvoice.invoiceNumber || `#${detailInvoice.id}`}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Clinic:</span>{" "}
                  <span className="font-medium" data-testid="text-detail-clinic">
                    {detailInvoice.clinicName}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Period:</span>{" "}
                  <span className="font-medium" data-testid="text-detail-period">
                    {detailInvoice.periodStart} — {detailInvoice.periodEnd}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Due Date:</span>{" "}
                  <span className="font-medium" data-testid="text-detail-due">
                    {detailInvoice.dueDate
                      ? formatDate(detailInvoice.dueDate)
                      : "-"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Subtotal:</span>{" "}
                  <span className="font-medium" data-testid="text-detail-subtotal">
                    {formatCents(detailInvoice.subtotalCents || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total:</span>{" "}
                  <span className="font-medium text-lg" data-testid="text-detail-total">
                    {formatCents(detailInvoice.totalCents || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge
                    variant={statusBadgeVariant(detailInvoice.status)}
                    data-testid="badge-detail-status"
                  >
                    {detailInvoice.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Payment:</span>{" "}
                  <Badge
                    variant={paymentBadgeVariant(detailInvoice.paymentStatus || "unpaid")}
                    data-testid="badge-detail-payment"
                  >
                    {detailInvoice.paymentStatus || "unpaid"}
                  </Badge>
                </div>
                {detailInvoice.finalizedAt && (
                  <div>
                    <span className="text-muted-foreground">Finalized At:</span>{" "}
                    <span className="font-medium" data-testid="text-detail-finalized">
                      {formatDateTime(detailInvoice.finalizedAt)}
                    </span>
                  </div>
                )}
              </div>

              {(detailInvoice.platformFeeCents > 0 || detailInvoice.netToCompanyCents > 0) && (
                <div className="border-t pt-3 space-y-1 text-sm">
                  <p className="font-medium">Platform Fee Breakdown</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-muted-foreground">Platform Fee:</span>{" "}
                      <span data-testid="text-detail-platform-fee">
                        {formatCents(detailInvoice.platformFeeCents || 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Net to Company:</span>{" "}
                      <span data-testid="text-detail-net-company">
                        {formatCents(detailInvoice.netToCompanyCents || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {(detailInvoice.stripeCheckoutUrl ||
                detailInvoice.receiptUrl ||
                detailInvoice.stripePaymentIntentId) && (
                <div className="border-t pt-3 space-y-2 text-sm">
                  <p className="font-medium">Payment Evidence</p>
                  {detailInvoice.stripeCheckoutUrl && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Checkout URL:</span>
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        data-testid="link-detail-checkout"
                      >
                        <a
                          href={detailInvoice.stripeCheckoutUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="w-3.5 h-3.5 mr-1" />
                          Open
                        </a>
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => copyToClipboard(detailInvoice.stripeCheckoutUrl)}
                        data-testid="button-copy-checkout"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                  {detailInvoice.receiptUrl && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Receipt:</span>
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        data-testid="link-detail-receipt"
                      >
                        <a
                          href={detailInvoice.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="w-3.5 h-3.5 mr-1" />
                          View Receipt
                        </a>
                      </Button>
                    </div>
                  )}
                  {detailInvoice.stripePaymentIntentId && (
                    <div>
                      <span className="text-muted-foreground">Payment Intent:</span>{" "}
                      <span
                        className="font-mono text-xs"
                        data-testid="text-detail-payment-intent"
                      >
                        {detailInvoice.stripePaymentIntentId}
                      </span>
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
