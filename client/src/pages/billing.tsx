import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { downloadWithAuth } from "@/lib/export";
import {
  FileText,
  Download,
  DollarSign,
  Calendar,
  Building2,
  Plus,
  Eye,
  CheckCircle,
  Loader2,
} from "lucide-react";

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getWeekAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().split("T")[0];
}

function statusBadgeVariant(status: string) {
  switch (status) {
    case "paid": return "default" as const;
    case "approved": return "secondary" as const;
    default: return "outline" as const;
  }
}

export default function BillingPage() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [selectedClinicId, setSelectedClinicId] = useState<string>("");
  const [startDate, setStartDate] = useState(getWeekAgo());
  const [endDate, setEndDate] = useState(getToday());
  const [showPreview, setShowPreview] = useState(false);
  const [showDetail, setShowDetail] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");

  const clinicsQuery = useQuery<any[]>({
    queryKey: ["/api/clinics"],
    queryFn: () => apiFetch("/api/clinics", token),
    enabled: !!token,
  });

  const weeklyQuery = useQuery<any[]>({
    queryKey: ["/api/billing/weekly", selectedClinicId],
    queryFn: () => {
      const params = selectedClinicId ? `?clinic_id=${selectedClinicId}` : "";
      return apiFetch(`/api/billing/weekly${params}`, token);
    },
    enabled: !!token,
  });

  const previewQuery = useQuery<any>({
    queryKey: ["/api/billing/weekly/preview", selectedClinicId, startDate, endDate],
    queryFn: () =>
      apiFetch(
        `/api/billing/weekly/preview?clinic_id=${selectedClinicId}&start_date=${startDate}&end_date=${endDate}`,
        token
      ),
    enabled: !!token && !!selectedClinicId && !!startDate && !!endDate && showPreview,
  });

  const detailQuery = useQuery<any>({
    queryKey: ["/api/billing/weekly", showDetail, "trips"],
    queryFn: () => apiFetch(`/api/billing/weekly/${showDetail}/trips`, token),
    enabled: !!token && showDetail !== null,
  });

  const generateMutation = useMutation({
    mutationFn: async (data: { clinicId: string; startDate: string; endDate: string; amount: string }) =>
      apiFetch("/api/billing/weekly/generate", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/weekly"] });
      setShowPreview(false);
      setCustomAmount("");
      toast({ title: `Weekly invoice created`, description: `${data.tripCount} trips, $${parseFloat(data.invoice.amount).toFixed(2)}` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const markPaidMutation = useMutation({
    mutationFn: async (invoiceId: number) =>
      apiFetch(`/api/invoices/${invoiceId}/mark-paid`, token, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/weekly"] });
      toast({ title: "Invoice marked as paid" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleDownloadPdf = async (invoiceId: number) => {
    await downloadWithAuth(`/api/billing/weekly/${invoiceId}/pdf`, `invoice-${invoiceId}-weekly.pdf`, "application/pdf", rawAuthFetch, (msg) => toast({ title: "Error", description: msg, variant: "destructive" }));
  };

  const clinics = clinicsQuery.data || [];
  const weeklyInvoices = weeklyQuery.data || [];
  const previewTrips = previewQuery.data?.trips || [];
  const previewCount = previewQuery.data?.count || 0;

  const computedTotal = previewTrips.reduce((sum: number, t: any) => {
    const dist = t.distanceMiles ? parseFloat(t.distanceMiles) : 0;
    return sum + dist;
  }, 0);

  const handleGenerate = () => {
    const amt = customAmount || "0.00";
    if (!selectedClinicId || !startDate || !endDate) return;
    generateMutation.mutate({ clinicId: selectedClinicId, startDate, endDate, amount: amt });
  };

  return (
    <div className="p-4 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <FileText className="w-6 h-6" />
        <h1 className="text-xl font-semibold" data-testid="text-billing-title">Billing - Weekly Invoices</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Generate Weekly Invoice
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Clinic</Label>
              <Select value={selectedClinicId} onValueChange={(v) => { setSelectedClinicId(v); setShowPreview(false); }}>
                <SelectTrigger data-testid="select-billing-clinic">
                  <SelectValue placeholder="Select clinic" />
                </SelectTrigger>
                <SelectContent>
                  {clinics.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)} data-testid={`option-clinic-${c.id}`}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setShowPreview(false); }}
                data-testid="input-billing-start-date"
              />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setShowPreview(false); }}
                data-testid="input-billing-end-date"
              />
            </div>
          </div>

          <Button
            onClick={() => setShowPreview(true)}
            disabled={!selectedClinicId || !startDate || !endDate}
            data-testid="button-preview-weekly"
            className="gap-1.5"
          >
            <Eye className="w-4 h-4" />
            Preview Trips
          </Button>

          {showPreview && (
            <div className="space-y-4 border-t pt-4">
              {previewQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : previewCount === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-uninvoiced-trips">
                  No uninvoiced completed trips found for the selected clinic and date range.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-4 flex-wrap">
                    <Badge variant="secondary" data-testid="badge-preview-count">
                      {previewCount} uninvoiced trips
                    </Badge>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="weekly-amount">Amount ($)</Label>
                      <Input
                        id="weekly-amount"
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-32"
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        placeholder="0.00"
                        data-testid="input-weekly-amount"
                      />
                    </div>
                  </div>

                  <div className="max-h-64 overflow-auto rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Patient</TableHead>
                          <TableHead>Pickup</TableHead>
                          <TableHead>Dropoff</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewTrips.map((t: any) => (
                          <TableRow key={t.id} data-testid={`row-preview-trip-${t.id}`}>
                            <TableCell className="text-sm">{t.scheduledDate}</TableCell>
                            <TableCell className="text-sm">{t.patientName}</TableCell>
                            <TableCell className="text-sm truncate max-w-[200px]">{t.pickupAddress}</TableCell>
                            <TableCell className="text-sm truncate max-w-[200px]">{t.dropoffAddress}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <Button
                    onClick={handleGenerate}
                    disabled={generateMutation.isPending || !customAmount}
                    data-testid="button-generate-weekly"
                    className="gap-1.5"
                  >
                    {generateMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <DollarSign className="w-4 h-4" />
                    )}
                    {generateMutation.isPending ? "Generating..." : "Generate Weekly Invoice"}
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Weekly Invoices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {weeklyQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : weeklyInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-weekly-invoices">
              No weekly invoices found.
            </p>
          ) : (
            <div className="overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Trips</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeklyInvoices.map((inv: any) => (
                    <TableRow key={inv.id} data-testid={`row-weekly-invoice-${inv.id}`}>
                      <TableCell className="font-mono text-sm" data-testid={`text-weekly-inv-id-${inv.id}`}>
                        #{inv.id}
                      </TableCell>
                      <TableCell data-testid={`text-weekly-inv-clinic-${inv.id}`}>
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-sm">{inv.clinicName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm" data-testid={`text-weekly-inv-period-${inv.id}`}>
                        {inv.serviceDate}
                      </TableCell>
                      <TableCell data-testid={`text-weekly-inv-trips-${inv.id}`}>
                        <Badge variant="secondary">{inv.tripCount} trips</Badge>
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-weekly-inv-amount-${inv.id}`}>
                        ${parseFloat(inv.amount).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(inv.status)} data-testid={`badge-weekly-inv-status-${inv.id}`}>
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(inv.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setShowDetail(inv.id)}
                            data-testid={`button-view-weekly-${inv.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDownloadPdf(inv.id)}
                            data-testid={`button-download-weekly-${inv.id}`}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          {inv.status !== "paid" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => markPaidMutation.mutate(inv.id)}
                              disabled={markPaidMutation.isPending}
                              data-testid={`button-mark-paid-weekly-${inv.id}`}
                              className="gap-1"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Pay
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

      <Dialog open={showDetail !== null} onOpenChange={(open) => !open && setShowDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Weekly Invoice Details
            </DialogTitle>
          </DialogHeader>
          {detailQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : detailQuery.data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Invoice #:</span>{" "}
                  <span className="font-medium" data-testid="text-detail-inv-id">{detailQuery.data.invoice?.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Clinic:</span>{" "}
                  <span className="font-medium" data-testid="text-detail-clinic">{detailQuery.data.clinic?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Period:</span>{" "}
                  <span className="font-medium" data-testid="text-detail-period">{detailQuery.data.invoice?.serviceDate}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Amount:</span>{" "}
                  <span className="font-medium" data-testid="text-detail-amount">
                    ${parseFloat(detailQuery.data.invoice?.amount || "0").toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge variant={statusBadgeVariant(detailQuery.data.invoice?.status)} data-testid="badge-detail-status">
                    {detailQuery.data.invoice?.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Trips:</span>{" "}
                  <span className="font-medium" data-testid="text-detail-trip-count">{detailQuery.data.trips?.length}</span>
                </div>
              </div>

              <div className="overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Pickup</TableHead>
                      <TableHead>Dropoff</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(detailQuery.data.trips || []).map((t: any, i: number) => (
                      <TableRow key={t.id} data-testid={`row-detail-trip-${t.id}`}>
                        <TableCell className="text-sm">{i + 1}</TableCell>
                        <TableCell className="text-sm">{t.scheduledDate}</TableCell>
                        <TableCell className="text-sm">{t.patientName}</TableCell>
                        <TableCell className="text-sm truncate max-w-[180px]">{t.pickupAddress}</TableCell>
                        <TableCell className="text-sm truncate max-w-[180px]">{t.dropoffAddress}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
