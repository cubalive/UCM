import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
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
import {
  DollarSign,
  Plus,
  Settings,
  FileText,
  Loader2,
  Pencil,
} from "lucide-react";

function cents(v: number): string {
  return (v / 100).toFixed(2);
}

export default function BillingTariffsPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editTariff, setEditTariff] = useState<any>(null);
  const [filterClinic, setFilterClinic] = useState("");
  const [backfillFrom, setBackfillFrom] = useState("");
  const [backfillTo, setBackfillTo] = useState("");
  const [invoiceClinic, setInvoiceClinic] = useState("");
  const [invoiceFrom, setInvoiceFrom] = useState("");
  const [invoiceTo, setInvoiceTo] = useState("");

  const clinicsQuery = useQuery<any[]>({
    queryKey: ["/api/clinics"],
    queryFn: () => apiFetch("/api/clinics", token),
    enabled: !!token,
  });

  const tariffsQuery = useQuery<any[]>({
    queryKey: ["/api/company/billing/tariffs", filterClinic],
    queryFn: () => {
      const params = filterClinic ? `?clinic_id=${filterClinic}` : "";
      return apiFetch(`/api/company/billing/tariffs${params}`, token);
    },
    enabled: !!token,
  });

  const invoicesQuery = useQuery<any[]>({
    queryKey: ["/api/company/billing/invoices"],
    queryFn: () => apiFetch("/api/company/billing/invoices", token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/company/billing/tariffs", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/billing/tariffs"] });
      setShowCreate(false);
      toast({ title: "Tariff created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiFetch(`/api/company/billing/tariffs/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/billing/tariffs"] });
      setEditTariff(null);
      toast({ title: "Tariff updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const backfillMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/company/billing/backfill?from=${backfillFrom}&to=${backfillTo}`, token, { method: "POST" }),
    onSuccess: (data: any) => {
      toast({ title: "Backfill complete", description: `Processed ${data.processed} trips, ${data.errors} errors` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const invoiceGenMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/company/billing/invoices/generate", token, {
        method: "POST",
        body: JSON.stringify({ clinicId: parseInt(invoiceClinic), periodStart: invoiceFrom, periodEnd: invoiceTo }),
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/billing/invoices"] });
      toast({ title: "Invoice generated", description: `Invoice #${data.invoiceNumber}` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const clinics = clinicsQuery.data || [];
  const tariffs = tariffsQuery.data || [];
  const invoices = invoicesQuery.data || [];

  return (
    <div className="p-4 space-y-6 max-w-7xl mx-auto" data-testid="billing-tariffs-page">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Billing Configuration</h1>
        <Button onClick={() => setShowCreate(true)} data-testid="button-create-tariff">
          <Plus className="w-4 h-4 mr-2" />
          New Tariff
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">Billing Backfill</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <div className="space-y-1">
                <Label>From</Label>
                <Input type="date" value={backfillFrom} onChange={(e) => setBackfillFrom(e.target.value)} data-testid="input-backfill-from" />
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <Input type="date" value={backfillTo} onChange={(e) => setBackfillTo(e.target.value)} data-testid="input-backfill-to" />
              </div>
            </div>
            <Button
              onClick={() => backfillMutation.mutate()}
              disabled={!backfillFrom || !backfillTo || backfillMutation.isPending}
              data-testid="button-run-backfill"
            >
              {backfillMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Run Backfill
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">Generate Invoice</CardTitle>
            <DollarSign className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Clinic</Label>
              <Select value={invoiceClinic} onValueChange={setInvoiceClinic}>
                <SelectTrigger data-testid="select-invoice-clinic">
                  <SelectValue placeholder="Select clinic" />
                </SelectTrigger>
                <SelectContent>
                  {clinics.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="space-y-1">
                <Label>Period Start</Label>
                <Input type="date" value={invoiceFrom} onChange={(e) => setInvoiceFrom(e.target.value)} data-testid="input-invoice-from" />
              </div>
              <div className="space-y-1">
                <Label>Period End</Label>
                <Input type="date" value={invoiceTo} onChange={(e) => setInvoiceTo(e.target.value)} data-testid="input-invoice-to" />
              </div>
            </div>
            <Button
              onClick={() => invoiceGenMutation.mutate()}
              disabled={!invoiceClinic || !invoiceFrom || !invoiceTo || invoiceGenMutation.isPending}
              data-testid="button-generate-invoice"
            >
              {invoiceGenMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Generate Invoice
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">Tariffs</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filterClinic} onValueChange={setFilterClinic}>
              <SelectTrigger className="w-48" data-testid="select-filter-clinic">
                <SelectValue placeholder="All clinics" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                {clinics.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {tariffsQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : tariffs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tariffs configured yet. Create one to start billing.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Base Fee</TableHead>
                    <TableHead>/Mile</TableHead>
                    <TableHead>/Min</TableHead>
                    <TableHead>WC Extra</TableHead>
                    <TableHead>No-Show</TableHead>
                    <TableHead>Cancel</TableHead>
                    <TableHead>Min Fare</TableHead>
                    <TableHead>Shared Mode</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tariffs.map((t: any) => (
                    <TableRow key={t.id} data-testid={`row-tariff-${t.id}`}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell>{t.clinicId ? clinics.find((c: any) => c.id === t.clinicId)?.name || t.clinicId : "Default"}</TableCell>
                      <TableCell>${cents(t.baseFeeCents)}</TableCell>
                      <TableCell>${cents(t.perMileCents)}</TableCell>
                      <TableCell>${cents(t.perMinuteCents)}</TableCell>
                      <TableCell>${cents(t.wheelchairExtraCents)}</TableCell>
                      <TableCell>${cents(t.noShowFeeCents)}</TableCell>
                      <TableCell>${cents(t.cancelFeeCents)}</TableCell>
                      <TableCell>${cents(t.minimumFareCents)}</TableCell>
                      <TableCell>{t.sharedTripMode}</TableCell>
                      <TableCell>
                        <Badge variant={t.active ? "default" : "secondary"} data-testid={`badge-tariff-active-${t.id}`}>
                          {t.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => setEditTariff(t)} data-testid={`button-edit-tariff-${t.id}`}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">Generated Invoices (V2)</CardTitle>
        </CardHeader>
        <CardContent>
          {invoicesQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No V2 invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv: any) => (
                    <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                      <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.clinicName || inv.clinicId}</TableCell>
                      <TableCell>{inv.periodStart} - {inv.periodEnd}</TableCell>
                      <TableCell>${cents(inv.totalCents)}</TableCell>
                      <TableCell>
                        <Badge variant={inv.status === "approved" ? "default" : "outline"}>
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={inv.paymentStatus === "paid" ? "default" : "secondary"}>
                          {inv.paymentStatus || "unpaid"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <TariffFormDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={(data: any) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
        clinics={clinics}
        title="Create Tariff"
      />

      {editTariff && (
        <TariffFormDialog
          open={true}
          onClose={() => setEditTariff(null)}
          onSubmit={(data: any) => updateMutation.mutate({ id: editTariff.id, data })}
          isPending={updateMutation.isPending}
          clinics={clinics}
          title="Edit Tariff"
          defaults={editTariff}
        />
      )}
    </div>
  );
}

function TariffFormDialog({ open, onClose, onSubmit, isPending, clinics, title, defaults }: any) {
  const [name, setName] = useState(defaults?.name || "");
  const [clinicId, setClinicId] = useState(defaults?.clinicId ? String(defaults.clinicId) : "");
  const [baseFeeCents, setBaseFeeCents] = useState(defaults?.baseFeeCents || 0);
  const [perMileCents, setPerMileCents] = useState(defaults?.perMileCents || 0);
  const [perMinuteCents, setPerMinuteCents] = useState(defaults?.perMinuteCents || 0);
  const [waitMinuteCents, setWaitMinuteCents] = useState(defaults?.waitMinuteCents || 0);
  const [wheelchairExtraCents, setWheelchairExtraCents] = useState(defaults?.wheelchairExtraCents || 0);
  const [noShowFeeCents, setNoShowFeeCents] = useState(defaults?.noShowFeeCents || 0);
  const [cancelFeeCents, setCancelFeeCents] = useState(defaults?.cancelFeeCents || 0);
  const [minimumFareCents, setMinimumFareCents] = useState(defaults?.minimumFareCents || 0);
  const [sharedTripMode, setSharedTripMode] = useState(defaults?.sharedTripMode || "PER_PATIENT");
  const [sharedTripDiscountPct, setSharedTripDiscountPct] = useState(defaults?.sharedTripDiscountPct || "0");
  const [active, setActive] = useState(defaults?.active !== false);

  const handleSubmit = () => {
    const data: any = {
      name,
      baseFeeCents: Number(baseFeeCents),
      perMileCents: Number(perMileCents),
      perMinuteCents: Number(perMinuteCents),
      waitMinuteCents: Number(waitMinuteCents),
      wheelchairExtraCents: Number(wheelchairExtraCents),
      noShowFeeCents: Number(noShowFeeCents),
      cancelFeeCents: Number(cancelFeeCents),
      minimumFareCents: Number(minimumFareCents),
      sharedTripMode,
      sharedTripDiscountPct: Number(sharedTripDiscountPct),
      active,
    };
    if (clinicId) data.clinicId = parseInt(clinicId);
    onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-tariff-name" />
          </div>
          <div className="space-y-1">
            <Label>Clinic (leave empty for company default)</Label>
            <Select value={clinicId} onValueChange={setClinicId}>
              <SelectTrigger data-testid="select-tariff-clinic">
                <SelectValue placeholder="Company Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Company Default</SelectItem>
                {clinics.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Base Fee (cents)</Label>
              <Input type="number" value={baseFeeCents} onChange={(e) => setBaseFeeCents(e.target.value)} data-testid="input-base-fee" />
            </div>
            <div className="space-y-1">
              <Label>Per Mile (cents)</Label>
              <Input type="number" value={perMileCents} onChange={(e) => setPerMileCents(e.target.value)} data-testid="input-per-mile" />
            </div>
            <div className="space-y-1">
              <Label>Per Minute (cents)</Label>
              <Input type="number" value={perMinuteCents} onChange={(e) => setPerMinuteCents(e.target.value)} data-testid="input-per-minute" />
            </div>
            <div className="space-y-1">
              <Label>Wait/Min (cents)</Label>
              <Input type="number" value={waitMinuteCents} onChange={(e) => setWaitMinuteCents(e.target.value)} data-testid="input-wait-min" />
            </div>
            <div className="space-y-1">
              <Label>Wheelchair Extra (cents)</Label>
              <Input type="number" value={wheelchairExtraCents} onChange={(e) => setWheelchairExtraCents(e.target.value)} data-testid="input-wheelchair" />
            </div>
            <div className="space-y-1">
              <Label>No-Show Fee (cents)</Label>
              <Input type="number" value={noShowFeeCents} onChange={(e) => setNoShowFeeCents(e.target.value)} data-testid="input-noshow" />
            </div>
            <div className="space-y-1">
              <Label>Cancel Fee (cents)</Label>
              <Input type="number" value={cancelFeeCents} onChange={(e) => setCancelFeeCents(e.target.value)} data-testid="input-cancel" />
            </div>
            <div className="space-y-1">
              <Label>Minimum Fare (cents)</Label>
              <Input type="number" value={minimumFareCents} onChange={(e) => setMinimumFareCents(e.target.value)} data-testid="input-min-fare" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Shared Trip Mode</Label>
            <Select value={sharedTripMode} onValueChange={setSharedTripMode}>
              <SelectTrigger data-testid="select-shared-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PER_PATIENT">Per Patient</SelectItem>
                <SelectItem value="SPLIT">Split</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Shared Trip Discount %</Label>
            <Input type="number" value={sharedTripDiscountPct} onChange={(e) => setSharedTripDiscountPct(e.target.value)} data-testid="input-shared-discount" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} id="tariff-active" data-testid="checkbox-tariff-active" />
            <Label htmlFor="tariff-active">Active</Label>
          </div>
          <Button onClick={handleSubmit} disabled={isPending || !name} className="w-full" data-testid="button-submit-tariff">
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {defaults ? "Update" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
