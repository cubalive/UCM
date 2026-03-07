import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { TripRef } from "@/components/trip-ref";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { downloadWithAuth } from "@/lib/export";
import {
  FileText,
  Download,
  DollarSign,
  Eye,
  CheckCircle,
  Loader2,
  MessageSquare,
  Phone,
} from "lucide-react";

function cents(v: number): string {
  return (v / 100).toFixed(2);
}

function paymentBadgeVariant(status: string) {
  if (status === "paid") return "default" as const;
  if (status === "partial") return "secondary" as const;
  return "outline" as const;
}

export default function ClinicBillingV2Page() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [showDetail, setShowDetail] = useState<number | null>(null);

  const invoicesQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/billing/invoices"],
    queryFn: () => apiFetch("/api/clinic/billing/invoices", token),
    enabled: !!token,
  });

  const detailQuery = useQuery<any>({
    queryKey: ["/api/clinic/billing/invoices", showDetail],
    queryFn: () => apiFetch(`/api/clinic/billing/invoices/${showDetail}`, token),
    enabled: !!token && showDetail !== null,
  });

  const dispatchQuery = useQuery<any>({
    queryKey: ["/api/clinic/dispatch-contact"],
    queryFn: () => apiFetch("/api/clinic/dispatch-contact", token),
    enabled: !!token,
  });

  const payMutation = useMutation({
    mutationFn: async (invoiceId: number) => {
      const result = await apiFetch(`/api/clinic/billing/invoices/${invoiceId}/pay`, token, { method: "POST" });
      return result;
    },
    onSuccess: (data: any) => {
      if (data.alreadyPaid) {
        toast({ title: "Already paid", description: "This invoice has already been paid." });
        if (data.receiptUrl) {
          window.open(data.receiptUrl, "_blank");
        }
        queryClient.invalidateQueries({ queryKey: ["/api/clinic/billing/invoices"] });
        return;
      }
      if (data.checkoutUrl) {
        toast({ title: "Redirecting to payment...", description: "You will be redirected to the secure payment page." });
        window.location.href = data.checkoutUrl;
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/billing/invoices"] });
      toast({ title: "Payment initiated" });
    },
    onError: (err: any) => toast({ title: "Payment Error", description: err.message, variant: "destructive" }),
  });

  const handleDownloadCsv = async (invoiceId: number, invoiceNumber: string) => {
    try {
      const response = await rawAuthFetch(`/api/clinic/billing/invoices/${invoiceId}/export.csv`);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceNumber || `invoice-${invoiceId}`}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download error", description: err.message, variant: "destructive" });
    }
  };

  const handleDownloadJson = async (invoiceId: number, invoiceNumber: string) => {
    try {
      const response = await rawAuthFetch(`/api/clinic/billing/invoices/${invoiceId}/export.json`);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceNumber || `invoice-${invoiceId}`}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download error", description: err.message, variant: "destructive" });
    }
  };

  const invoices = invoicesQuery.data || [];
  const detail = detailQuery.data;
  const dispatch = dispatchQuery.data;

  const totalOutstanding = invoices
    .filter((inv: any) => inv.paymentStatus !== "paid")
    .reduce((sum: number, inv: any) => sum + (inv.balanceDueCents || inv.totalCents || 0), 0);
  const totalPaid = invoices
    .filter((inv: any) => inv.paymentStatus === "paid")
    .reduce((sum: number, inv: any) => sum + (inv.totalCents || 0), 0);
  const unpaidCount = invoices.filter((inv: any) => inv.paymentStatus !== "paid").length;

  return (
    <div className="p-4 space-y-6 max-w-5xl mx-auto" data-testid="clinic-billing-v2-page">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Billing & Invoices</h1>
        {dispatch?.dispatchPhone && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild data-testid="button-call-dispatch">
              <a href={`tel:${dispatch.dispatchPhone}`}>
                <Phone className="w-4 h-4 mr-1" />
                Call Dispatch
              </a>
            </Button>
          </div>
        )}
      </div>

      {invoices.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Outstanding Balance</p>
              <p className="text-2xl font-bold text-orange-600" data-testid="text-outstanding-balance">${cents(totalOutstanding)}</p>
              <p className="text-xs text-muted-foreground">{unpaidCount} unpaid invoice{unpaidCount !== 1 ? "s" : ""}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Paid</p>
              <p className="text-2xl font-bold text-green-600" data-testid="text-total-paid">${cents(totalPaid)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Invoices</p>
              <p className="text-2xl font-bold" data-testid="text-total-invoices">{invoices.length}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">Your Invoices</CardTitle>
          <FileText className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {invoicesQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-invoices">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv: any) => (
                    <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                      <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.periodStart} - {inv.periodEnd}</TableCell>
                      <TableCell>${cents(inv.totalCents)}</TableCell>
                      <TableCell>
                        <Badge variant={inv.status === "finalized" ? "secondary" : inv.status === "void" ? "destructive" : "outline"} data-testid={`badge-status-${inv.id}`}>
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={paymentBadgeVariant(inv.paymentStatus || "unpaid")} data-testid={`badge-payment-${inv.id}`}>
                          {inv.paymentStatus || "unpaid"}
                        </Badge>
                      </TableCell>
                      <TableCell>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => setShowDetail(inv.id)} data-testid={`button-view-invoice-${inv.id}`}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleDownloadCsv(inv.id, inv.invoiceNumber)} data-testid={`button-download-csv-${inv.id}`}>
                            <Download className="w-4 h-4" />
                          </Button>
                          {inv.paymentStatus !== "paid" && (
                            <Button
                              size="sm"
                              onClick={() => payMutation.mutate(inv.id)}
                              disabled={payMutation.isPending}
                              data-testid={`button-pay-invoice-${inv.id}`}
                            >
                              {payMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4 mr-1" />}
                              Pay Now
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

      {showDetail !== null && (
        <Dialog open={true} onOpenChange={(v) => !v && setShowDetail(null)}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Invoice Details</DialogTitle>
            </DialogHeader>
            {detailQuery.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
            ) : detail ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Invoice #</p>
                    <p className="font-medium" data-testid="text-invoice-number">{detail.invoice.invoiceNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Period</p>
                    <p>{detail.invoice.periodStart} - {detail.invoice.periodEnd}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total</p>
                    <p className="font-medium text-lg" data-testid="text-invoice-total">${cents(detail.invoice.totalCents)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Payment Status</p>
                    <Badge variant={paymentBadgeVariant(detail.invoice.paymentStatus || "unpaid")} data-testid="badge-detail-payment">
                      {detail.invoice.paymentStatus || "unpaid"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Invoice Status</p>
                    <Badge variant={detail.invoice.status === "finalized" ? "secondary" : "outline"} data-testid="badge-detail-status">
                      {detail.invoice.status}
                    </Badge>
                  </div>
                  {detail.invoice.dueDate && (
                    <div>
                      <p className="text-sm text-muted-foreground">Due Date</p>
                      <p>{new Date(detail.invoice.dueDate).toLocaleDateString()}</p>
                    </div>
                  )}
                  {detail.invoice.amountPaidCents > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Amount Paid</p>
                      <p className="font-medium text-green-600">${cents(detail.invoice.amountPaidCents)}</p>
                    </div>
                  )}
                  {detail.invoice.balanceDueCents > 0 && detail.invoice.paymentStatus !== "paid" && (
                    <div>
                      <p className="text-sm text-muted-foreground">Balance Due</p>
                      <p className="font-medium text-orange-600">${cents(detail.invoice.balanceDueCents)}</p>
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Patient</TableHead>
                        <TableHead>Trip</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detail.items || []).map((item: any, i: number) => (
                        <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell>{item.patientName}</TableCell>
                          <TableCell>
                            {item.tripId ? (
                              <TripRef tripId={item.tripId} publicId={item.trip?.publicId} />
                            ) : "-"}
                          </TableCell>
                          <TableCell className="max-w-xs truncate">{item.description}</TableCell>
                          <TableCell>${cents(item.amountCents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex justify-between items-center gap-2 flex-wrap pt-2 border-t">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleDownloadCsv(detail.invoice.id, detail.invoice.invoiceNumber)} data-testid="button-detail-download-csv">
                      <Download className="w-4 h-4 mr-1" />
                      CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDownloadJson(detail.invoice.id, detail.invoice.invoiceNumber)} data-testid="button-detail-download-json">
                      <Download className="w-4 h-4 mr-1" />
                      JSON
                    </Button>
                  </div>
                  {detail.invoice.paymentStatus !== "paid" && (
                    <Button onClick={() => payMutation.mutate(detail.invoice.id)} disabled={payMutation.isPending} data-testid="button-detail-pay">
                      {payMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      <DollarSign className="w-4 h-4 mr-1" />
                      Pay Now
                    </Button>
                  )}
                  {detail.invoice.paymentStatus === "paid" && detail.invoice.receiptUrl && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={detail.invoice.receiptUrl} target="_blank" rel="noopener noreferrer">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        View Receipt
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">Failed to load invoice details.</p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
