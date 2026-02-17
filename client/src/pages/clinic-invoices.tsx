import { useState } from "react";
import { useAuth, authHeaders } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import type { Invoice } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Download, Receipt, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadWithAuth } from "@/lib/export";
import { rawAuthFetch } from "@/lib/api";

function InvoiceMapThumb({ tripId, token }: { tripId: number | null; token: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!tripId || !token || failed) {
    return (
      <div className="w-16 h-8 bg-muted rounded flex items-center justify-center">
        <MapPin className="w-3 h-3 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={`/api/trips/${tripId}/static-map/thumb?t=${encodeURIComponent(token)}`}
      alt="Route"
      className="w-16 h-8 object-cover rounded"
      loading="lazy"
      onError={() => setFailed(true)}
      data-testid={`img-invoice-map-${tripId}`}
    />
  );
}

function statusVariant(status: string) {
  switch (status) {
    case "paid":
      return "default" as const;
    case "approved":
      return "secondary" as const;
    case "pending":
      return "outline" as const;
    default:
      return "outline" as const;
  }
}

function formatAmount(amount: string | number) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatDate(dateStr: string) {
  try {
    const [y, m, d] = dateStr.split("-");
    if (y && m && d) {
      return `${m}/${d}/${y}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

export default function ClinicInvoicesPage() {
  const { token, user, isSuperAdmin } = useAuth();

  const isAdmin = isSuperAdmin || user?.role === "ADMIN" || user?.role === "DISPATCH";

  const { data: invoicesList, isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/clinic/invoices"],
    queryFn: async () => {
      const res = await fetch("/api/clinic/invoices", {
        headers: authHeaders(token),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to load invoices" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    enabled: !!token,
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-invoices-title">
            Invoices
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin ? "All clinic invoices" : "Your clinic invoices and receipts"}
          </p>
        </div>
        <Badge variant="secondary" data-testid="badge-invoice-count">
          <Receipt className="w-3 h-3 mr-1" />
          {invoicesList?.length ?? 0} invoices
        </Badge>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Invoice History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !invoicesList || invoicesList.length === 0 ? (
            <div className="text-center py-12" data-testid="empty-invoices">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No invoices found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Route</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Download</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoicesList.map((inv) => (
                    <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                      <TableCell>
                        <InvoiceMapThumb tripId={inv.tripId} token={token} />
                      </TableCell>
                      <TableCell data-testid={`text-invoice-date-${inv.id}`}>
                        {formatDate(inv.serviceDate)}
                      </TableCell>
                      <TableCell data-testid={`text-invoice-patient-${inv.id}`}>
                        {inv.patientName}
                      </TableCell>
                      <TableCell className="text-right font-medium" data-testid={`text-invoice-amount-${inv.id}`}>
                        {formatAmount(inv.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(inv.status)} data-testid={`badge-invoice-status-${inv.id}`}>
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {inv.pdfUrl ? (
                          <DownloadPdfButton invoiceId={inv.id} pdfUrl={inv.pdfUrl} />
                        ) : (
                          <span className="text-xs text-muted-foreground">N/A</span>
                        )}
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

function DownloadPdfButton({ invoiceId, pdfUrl }: { invoiceId: number; pdfUrl: string }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const handleClick = async () => {
    setLoading(true);
    await downloadWithAuth(pdfUrl, `invoice-${invoiceId}.pdf`, "application/pdf", rawAuthFetch, (msg) => toast({ title: "Download failed", description: msg, variant: "destructive" }));
    setLoading(false);
  };
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleClick}
      disabled={loading}
      data-testid={`button-download-invoice-${invoiceId}`}
    >
      <Download className="w-4 h-4 mr-1" />
      {loading ? "..." : "PDF"}
    </Button>
  );
}
