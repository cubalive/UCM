import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertTriangle, FileText, DollarSign, Calendar } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/timezone";
import { ClinicRef } from "@/components/entity-ref";

const STATUS_VARIANTS: Record<string, string> = {
  draft: "secondary",
  finalized: "default",
  sent: "default",
  paid: "secondary",
  overdue: "destructive",
  cancelled: "destructive",
  void: "destructive",
};

const PAYMENT_VARIANTS: Record<string, string> = {
  unpaid: "destructive",
  partial: "secondary",
  paid: "default",
  refunded: "secondary",
};

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}


export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { token } = useAuth();

  const { data: allInvoices, isLoading: loadingInvoices } = useQuery<any[]>({
    queryKey: ["/api/billing/weekly"],
    queryFn: () => apiFetch("/api/billing/weekly", token),
    enabled: !!token && invoiceId > 0,
  });

  const invoice = allInvoices?.find((inv: any) => inv.id === invoiceId);

  const { data: trips, isLoading: loadingTrips } = useQuery<any[]>({
    queryKey: ["/api/billing/weekly", invoiceId, "trips"],
    queryFn: () => apiFetch(`/api/billing/weekly/${invoiceId}/trips`, token),
    enabled: !!token && invoiceId > 0,
  });

  const isLoading = loadingInvoices;

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <Button variant="ghost" onClick={() => navigate("/invoices")} data-testid="button-back-invoices">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Invoices
        </Button>
        <Card className="mt-4">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground" data-testid="text-invoice-not-found">Invoice not found or access denied.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto overflow-y-auto h-full" data-testid="invoice-detail-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" onClick={() => navigate("/invoices")} data-testid="button-back-invoices">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <FileText className="w-5 h-5 text-muted-foreground" />
          <span className="text-lg font-mono font-semibold" data-testid="text-invoice-number">
            {invoice.invoiceNumber || `INV-${invoice.id}`}
          </span>
          <Badge variant={(STATUS_VARIANTS[invoice.status] as any) || "secondary"} data-testid="badge-invoice-status">
            {invoice.status?.replace(/_/g, " ").toUpperCase() || "DRAFT"}
          </Badge>
          <Badge variant={(PAYMENT_VARIANTS[invoice.paymentStatus] as any) || "secondary"} data-testid="badge-payment-status">
            {invoice.paymentStatus?.toUpperCase() || "UNPAID"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Invoice Details</h3>

            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Clinic:</span>
                {invoice.clinicId ? (
                  <ClinicRef id={invoice.clinicId} label={invoice.clinicName} />
                ) : (
                  <span className="text-sm" data-testid="text-clinic-name">{invoice.clinicName || "—"}</span>
                )}
              </div>

              <div className="flex items-center gap-2 text-sm flex-wrap">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Period:</span>
                <span data-testid="text-invoice-period">
                  {formatDate(invoice.periodStart)} — {formatDate(invoice.periodEnd)}
                </span>
              </div>

              {invoice.dueDate && (
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Due Date:</span>
                  <span data-testid="text-invoice-due-date">{formatDate(invoice.dueDate)}</span>
                </div>
              )}

              {invoice.tripCount != null && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Trips: </span>
                  <span data-testid="text-invoice-trip-count">{invoice.tripCount}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <DollarSign className="w-4 h-4" />
              Financial Summary
            </h3>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span data-testid="text-invoice-subtotal">{formatCents(invoice.subtotalCents)}</span>
              </div>
              {invoice.feesCents > 0 && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Fees</span>
                  <span data-testid="text-invoice-fees">{formatCents(invoice.feesCents)}</span>
                </div>
              )}
              {invoice.taxCents > 0 && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span data-testid="text-invoice-tax">{formatCents(invoice.taxCents)}</span>
                </div>
              )}
              {invoice.platformFeeCents > 0 && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Platform Fee</span>
                  <span data-testid="text-invoice-platform-fee">{formatCents(invoice.platformFeeCents)}</span>
                </div>
              )}
              <div className="border-t pt-2 flex items-center justify-between gap-2 text-sm font-semibold">
                <span>Total</span>
                <span data-testid="text-invoice-total">{formatCents(invoice.totalCents)}</span>
              </div>
              {invoice.amountPaidCents > 0 && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Amount Paid</span>
                  <span data-testid="text-invoice-amount-paid">{formatCents(invoice.amountPaidCents)}</span>
                </div>
              )}
              {invoice.balanceDueCents > 0 && (
                <div className="flex items-center justify-between gap-2 text-sm font-medium">
                  <span className="text-muted-foreground">Balance Due</span>
                  <span data-testid="text-invoice-balance-due">{formatCents(invoice.balanceDueCents)}</span>
                </div>
              )}
            </div>

            {invoice.notes && (
              <div className="pt-2 border-t">
                <span className="text-sm text-muted-foreground">Notes: </span>
                <span className="text-sm" data-testid="text-invoice-notes">{invoice.notes}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="py-4 space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Line Items / Trips</h3>
          {loadingTrips ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : trips && trips.length > 0 ? (
            <div className="space-y-1">
              {trips.map((trip: any, idx: number) => (
                <div
                  key={trip.id || idx}
                  className="flex items-center justify-between gap-2 py-2 border-b last:border-b-0 flex-wrap"
                  data-testid={`row-trip-${trip.id || idx}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => navigate(`/trips/${trip.id}`)}
                      className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-mono cursor-pointer"
                      data-testid={`link-trip-${trip.id}`}
                    >
                      {trip.publicId || `#${trip.id}`}
                    </button>
                    {trip.status && (
                      <Badge variant="outline" className="text-xs" data-testid={`badge-trip-status-${trip.id}`}>
                        {trip.status.replace(/_/g, " ")}
                      </Badge>
                    )}
                    {trip.pickupAddress && (
                      <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {trip.pickupAddress}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {trip.scheduledDate && (
                      <span className="text-xs text-muted-foreground" data-testid={`text-trip-date-${trip.id}`}>
                        {trip.scheduledDate}
                      </span>
                    )}
                    {trip.priceCents != null && (
                      <span className="text-xs font-medium" data-testid={`text-trip-price-${trip.id}`}>
                        {formatCents(trip.priceCents)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-no-trips">No trips found for this invoice.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
